use crate::error::AppError;
use crate::models::api::JobSubmissionView;
use crate::models::domain::{now_iso, JobSnapshot, JobStatusKind, WorkflowKind};
use crate::models::request::{CreateJobInput, JobSourceInput};
use crate::services::jobs::stage_plan::resume_plan;

use super::super::super::creation::create_translation_job;
use super::super::super::query::load_job_or_404;
use super::super::JobsFacade;
use crate::services::job_launcher::start_job_execution;

impl<'a> JobsFacade<'a> {
    pub fn rerun_submission(
        &self,
        base_url: &str,
        source_job_id: &str,
    ) -> Result<JobSubmissionView, AppError> {
        let source_job = load_job_or_404(self.command.db, source_job_id)?;
        if resume_plan(&source_job).resume_workflow == Some(WorkflowKind::Render) {
            let job = prepare_in_place_render_job(source_job)?;
            let job = start_job_execution(&self.command.submit.launcher, job)?;
            return Ok(self.build_submission_view(
                base_url,
                &job,
                JobStatusKind::Queued,
                WorkflowKind::Render,
            ));
        }
        let request = build_rerun_request(&source_job)?;
        let workflow = request.workflow.clone();
        let job = create_translation_job(&self.command.submit, &request)?;
        // 重跑即链文档（同 retry）：新任务无 upload_id，走源任务反查文档。
        match self.command.db.get_document_by_job_id(source_job_id) {
            Ok(Some(doc)) => {
                if let Err(error) = self
                    .command
                    .db
                    .set_document_active_job(&doc.document_id, &job.job_id, None)
                {
                    tracing::warn!(
                        "library: set active job for {} at rerun failed: {error}",
                        doc.document_id
                    );
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(
                    "library: resolve document for rerun source {source_job_id} failed: {error}"
                );
            }
        }
        Ok(self.build_submission_view(base_url, &job, JobStatusKind::Queued, workflow))
    }
}

pub(super) fn prepare_in_place_render_job(mut job: JobSnapshot) -> Result<JobSnapshot, AppError> {
    if matches!(job.status, JobStatusKind::Queued | JobStatusKind::Running) {
        return Err(AppError::conflict(
            "job is already queued or running; cancel it before rerender",
        ));
    }

    let now = now_iso();
    job.workflow = WorkflowKind::Render;
    job.request_payload.workflow = WorkflowKind::Render;
    job.request_payload.source.upload_id.clear();
    job.request_payload.source.source_url.clear();
    job.request_payload.source.artifact_job_id = job.job_id.clone();
    job.request_payload.runtime.job_id = job.job_id.clone();
    job.status = JobStatusKind::Queued;
    job.updated_at = now;
    job.started_at = None;
    job.finished_at = None;
    job.pid = None;
    job.command.clear();
    job.error = None;
    job.stage = Some("queued".to_string());
    job.stage_detail = Some("重渲染任务排队中，等待可用执行槽位".to_string());
    job.progress_current = Some(0);
    job.progress_total = None;
    job.log_tail.clear();
    job.result = None;
    job.runtime = None;
    job.replace_failure_info(None);
    reset_render_artifacts(&mut job);
    job.sync_runtime_state();
    Ok(job)
}

fn reset_render_artifacts(job: &mut JobSnapshot) {
    let Some(artifacts) = job.artifacts.as_mut() else {
        return;
    };
    artifacts.output_pdf = None;
    artifacts.summary = None;
    artifacts.events_jsonl = None;
    artifacts.pages_processed = None;
    artifacts.translate_render_time_seconds = None;
    artifacts.save_time_seconds = None;
    artifacts.total_time_seconds = None;
}

fn build_rerun_request(source_job: &JobSnapshot) -> Result<CreateJobInput, AppError> {
    let plan = resume_plan(source_job);
    let workflow = plan.resume_workflow.ok_or_else(|| {
        AppError::bad_request(
            plan.reason
                .unwrap_or_else(|| "source job has no reusable checkpoint for rerun".to_string()),
        )
    })?;
    let mut request = CreateJobInput {
        workflow,
        source: JobSourceInput {
            upload_id: source_job.request_payload.source.upload_id.clone(),
            source_url: source_job.request_payload.source.source_url.clone(),
            artifact_job_id: source_job.request_payload.source.artifact_job_id.clone(),
        },
        ocr: source_job.request_payload.ocr.clone(),
        translation: source_job.request_payload.translation.clone(),
        render: source_job.request_payload.render.clone(),
        runtime: source_job.request_payload.runtime.clone(),
    };
    request.source.upload_id.clear();
    request.source.source_url.clear();
    request.source.artifact_job_id = source_job.job_id.clone();
    request.runtime.job_id.clear();
    Ok(request)
}
