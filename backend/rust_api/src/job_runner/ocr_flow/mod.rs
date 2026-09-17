use crate::models::domain::{now_iso, JobRuntimeState, JobStatusKind};
use crate::ocr_provider::{is_configured_command_provider, parse_provider_kind, OcrProviderKind};
use crate::worker_command::{build_ocr_command, build_worker_stage_command, WorkerStageCommand};
use anyhow::Result;

use super::{
    clear_canceled_runtime_artifacts, clear_job_failure, execute_process_job, job_artifacts_mut,
    sync_runtime_state, ProcessRuntimeDeps,
};

#[cfg(test)]
mod failure_regression_tests;

mod artifacts;
mod bundle_download;
mod bundle_download_retry;
mod bundle_events;
mod bundle_ready_wait;
mod bundle_retry_policy;
mod markdown_bundle;
mod mineru;
mod mineru_polling;
mod mineru_retry;
mod mineru_status_handlers;
mod paddle;
mod paddle_errors;
mod paddle_markdown;
mod paddle_payload;
mod page_subset;
mod polling;
mod provider_result;
mod provider_transport;
mod status;
mod support;
mod transport;
mod workspace;

use super::cancel_registry::is_cancel_requested_with_registry;
use provider_transport::execute_provider_transport;
pub use support::sync_parent_with_ocr_child;
use support::{fail_missing_source_pdf, fail_ocr_transport, save_ocr_job};
use transport::resolve_local_upload_path;
use workspace::OcrWorkspace;

pub async fn execute_ocr_job(
    deps: ProcessRuntimeDeps,
    job: JobRuntimeState,
    output_job_id_override: Option<String>,
    parent_job_id: Option<String>,
) -> Result<JobRuntimeState> {
    let job_id = job.job_id.clone();
    match execute_ocr_job_inner(
        deps.clone(),
        job,
        output_job_id_override,
        parent_job_id.clone(),
    )
    .await
    {
        Ok(job) => Ok(job),
        Err(err) => {
            // OCR children run inline, outside the top-level lifecycle error handler.
            let mut job = deps.db.get_job(&job_id)?.into_runtime();
            let parent_canceled = if let Some(parent_id) = parent_job_id.as_deref() {
                is_cancel_requested_with_registry(deps.canceled_jobs.as_ref(), parent_id).await
                    || deps.db.get_job(parent_id)?.status == JobStatusKind::Canceled
            } else {
                false
            };
            if parent_canceled
                || job.status == JobStatusKind::Canceled
                || is_cancel_requested_with_registry(deps.canceled_jobs.as_ref(), &job_id).await
            {
                job.status = JobStatusKind::Canceled;
                job.stage = Some("canceled".to_string());
                job.stage_detail = Some("OCR task canceled".to_string());
                clear_canceled_runtime_artifacts(&mut job);
                clear_job_failure(&mut job);
            } else {
                super::append_error_chain_log(&mut job, &err);
                let detail = super::format_error_chain(&err);
                job.status = JobStatusKind::Failed;
                job.stage = Some("failed".to_string());
                job.stage_detail = Some(detail.clone());
                job.error = Some(detail);
                super::refresh_job_failure(&mut job);
            }
            job.pid = None;
            job.updated_at = now_iso();
            job.finished_at = Some(now_iso());
            sync_runtime_state(&mut job);
            save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;
            Ok(job)
        }
    }
}

async fn execute_ocr_job_inner(
    deps: ProcessRuntimeDeps,
    mut job: JobRuntimeState,
    output_job_id_override: Option<String>,
    parent_job_id: Option<String>,
) -> Result<JobRuntimeState> {
    let is_command_provider = is_configured_command_provider(&job.request_payload.ocr.provider);
    let provider_kind = if is_command_provider {
        OcrProviderKind::Local
    } else {
        parse_provider_kind(&job.request_payload.ocr.provider)
    };
    job.status = JobStatusKind::Running;
    if job.started_at.is_none() {
        job.started_at = Some(now_iso());
    }
    job.updated_at = now_iso();
    job.stage = Some("ocr_upload".to_string());
    job.stage_detail = Some("OCR provider transport 启动中".to_string());
    clear_job_failure(&mut job);
    sync_runtime_state(&mut job);
    save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;

    let workspace = OcrWorkspace::prepare(
        &deps.persist.output_root,
        &mut job,
        &provider_kind,
        output_job_id_override,
    )?;
    let upload_path = resolve_local_upload_path(deps.db.as_ref(), &job)?;
    job.command = build_ocr_command(
        &deps.worker_command_runtime(),
        upload_path.as_deref(),
        &job.request_payload,
        &workspace.job_paths,
    )?;
    save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;

    if is_command_provider {
        return execute_process_job(deps, job, &[]).await;
    }

    let source_pdf_path = match execute_provider_transport(
        &deps,
        &mut job,
        &provider_kind,
        &workspace,
        parent_job_id.as_deref(),
    )
    .await
    {
        Ok(path) => path,
        Err(err) => {
            fail_ocr_transport(&mut job, &err);
            return Ok(job);
        }
    };

    if is_cancel_requested_with_registry(deps.canceled_jobs.as_ref(), &job.job_id).await {
        job.status = JobStatusKind::Canceled;
        job.stage = Some("canceled".to_string());
        job.stage_detail = Some("OCR 任务已取消".to_string());
        job.updated_at = now_iso();
        job.finished_at = Some(now_iso());
        clear_canceled_runtime_artifacts(&mut job);
        clear_job_failure(&mut job);
        sync_runtime_state(&mut job);
        save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;
        return Ok(job);
    }

    if !source_pdf_path.exists() {
        fail_missing_source_pdf(&mut job, &source_pdf_path);
        save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;
        return Ok(job);
    }

    let source_pdf_string = source_pdf_path.to_string_lossy().to_string();
    job_artifacts_mut(&mut job).source_pdf = Some(source_pdf_string);

    job.command = build_worker_stage_command(
        &deps.worker_command_runtime(),
        &job.request_payload,
        &workspace.job_paths,
        WorkerStageCommand::NormalizeOcr {
            source_json_path: &workspace.layout_json_path,
            source_pdf_path: &source_pdf_path,
            provider_result_json_path: &workspace.provider_result_json_path,
            provider_zip_path: &workspace.provider_zip_path,
            provider_raw_dir: &workspace.provider_raw_dir,
        },
    )?;
    job.stage = Some("normalizing".to_string());
    job.stage_detail = Some("OCR provider 已完成，开始标准化 document.v1".to_string());
    job.updated_at = now_iso();
    sync_runtime_state(&mut job);
    save_ocr_job(&deps, &job, parent_job_id.as_deref()).await?;

    execute_process_job(deps, job, &[]).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::domain::JobSnapshot;
    use crate::models::request::CreateJobInput;

    #[test]
    fn fail_missing_source_pdf_marks_job_failed_with_clear_detail() {
        let mut job = JobSnapshot::new(
            "job-missing-source-pdf".to_string(),
            CreateJobInput::default(),
            vec!["python".to_string()],
        )
        .into_runtime();
        let missing = std::path::Path::new("/definitely/missing/source.pdf");

        fail_missing_source_pdf(&mut job, missing);

        assert_eq!(job.status, JobStatusKind::Failed);
        assert_eq!(job.stage.as_deref(), Some("failed"));
        assert_eq!(
            job.stage_detail.as_deref(),
            Some("OCR 已完成，但任务源 PDF 缺失")
        );
        let failure = job.failure.as_ref().expect("failure");
        assert_eq!(failure.category, "source_pdf_missing");
        assert_eq!(failure.summary, "源 PDF 缺失");
        assert!(!failure.retryable);
    }
}
