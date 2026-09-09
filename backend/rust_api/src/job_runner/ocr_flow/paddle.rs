use anyhow::Result;
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::models::domain::{now_iso, JobRuntimeState};
use crate::ocr_provider::paddle::{
    map_task_status as map_paddle_task_status, normalize_model_name, PaddleClient,
    PaddleProviderError,
};
use crate::ocr_provider::OcrTaskHandle;

use super::artifacts::persist_provider_result;
use super::paddle_errors::attach_paddle_runtime_error;
use super::paddle_markdown::materialize_paddle_markdown_artifacts;
use super::paddle_payload::build_paddle_optional_payload;
use super::polling::{should_stop_polling, wait_next_poll_or_timeout};
use super::status::{record_provider_trace, update_ocr_job_from_status};
use crate::job_runner::{ocr_provider_diagnostics_mut, ProcessRuntimeDeps};

use super::save_ocr_job;

pub(super) async fn run_local_ocr_transport_paddle(
    deps: &ProcessRuntimeDeps,
    job: &mut JobRuntimeState,
    client: &PaddleClient,
    upload_path: &Path,
    provider_result_json_path: &Path,
    job_root: &Path,
    parent_job_id: Option<&str>,
) -> Result<()> {
    log_paddle_unsupported_options(job);
    let model_name = normalize_model_name(&job.request_payload.ocr.paddle_model);
    job.request_payload.ocr.paddle_model = model_name.clone();
    let (submit_path, cache_bust_guard) = prepare_paddle_submit_path(job, upload_path);
    let created = client
        .submit_local_file(
            &submit_path,
            &model_name,
            &build_paddle_optional_payload(&model_name, deps.paddle_runtime().max_input_images),
        )
        .await
        .map_err(|err| attach_paddle_runtime_error(job, err, "submit"));
    if let Some(temp_path) = cache_bust_guard {
        let _ = std::fs::remove_file(&temp_path);
    }
    let created = created?;
    run_paddle_poll_loop(
        deps,
        job,
        client,
        created.data,
        created.trace_id,
        provider_result_json_path,
        job_root,
        parent_job_id,
    )
    .await
}

pub(super) async fn run_remote_ocr_transport_paddle(
    deps: &ProcessRuntimeDeps,
    job: &mut JobRuntimeState,
    client: &PaddleClient,
    provider_result_json_path: &Path,
    job_root: &Path,
    parent_job_id: Option<&str>,
) -> Result<()> {
    log_paddle_unsupported_options(job);
    let model_name = normalize_model_name(&job.request_payload.ocr.paddle_model);
    job.request_payload.ocr.paddle_model = model_name.clone();
    let created = client
        .submit_remote_url(
            &job.request_payload.source.source_url,
            &model_name,
            &build_paddle_optional_payload(&model_name, deps.paddle_runtime().max_input_images),
        )
        .await
        .map_err(|err| attach_paddle_runtime_error(job, err, "submit"))?;
    run_paddle_poll_loop(
        deps,
        job,
        client,
        created.data,
        created.trace_id,
        provider_result_json_path,
        job_root,
        parent_job_id,
    )
    .await
}

async fn run_paddle_poll_loop(
    deps: &ProcessRuntimeDeps,
    job: &mut JobRuntimeState,
    client: &PaddleClient,
    job_id: String,
    trace_id: Option<String>,
    provider_result_json_path: &Path,
    job_root: &Path,
    parent_job_id: Option<&str>,
) -> Result<()> {
    record_provider_trace(job, trace_id);
    ocr_provider_diagnostics_mut(job).handle.task_id = Some(job_id.clone());
    job.append_log(&format!("task_id: {}", job_id));
    job.stage = Some("ocr_processing".to_string());
    job.stage_detail = Some("Paddle 任务已提交，等待解析".to_string());
    job.updated_at = now_iso();
    save_ocr_job(deps, job, parent_job_id).await?;

    let poll_interval = std::cmp::max(job.request_payload.ocr.poll_interval, 1) as u64;
    let timeout_secs = std::cmp::max(job.request_payload.ocr.poll_timeout, 1) as u64;

    let started = std::time::Instant::now();
    loop {
        if should_stop_polling(&deps.canceled_jobs, &job.job_id).await {
            return Ok(());
        }
        let task = client
            .query_job(&job_id)
            .await
            .map_err(|err| attach_paddle_runtime_error(job, err, "poll"))?;
        record_provider_trace(job, task.trace_id.clone());
        let item = task.data;
        job.append_log(&format!("paddle task {}: state={}", job_id, item.state));
        update_ocr_job_from_status(
            deps,
            job,
            map_paddle_task_status(
                &item.state,
                OcrTaskHandle {
                    batch_id: None,
                    task_id: Some(job_id.clone()),
                    file_name: None,
                },
                Some(item.error_msg.clone()),
                task.trace_id.clone(),
            ),
            item.extract_progress
                .as_ref()
                .and_then(|progress| progress.extracted_pages),
            item.extract_progress
                .as_ref()
                .and_then(|progress| progress.total_pages),
            parent_job_id,
        )
        .await?;

        if item.state == "done" {
            let jsonl_url = item
                .result_url
                .as_ref()
                .map(|v| v.json_url.trim().to_string())
                .filter(|v| !v.is_empty())
                .ok_or_else(|| {
                    anyhow::Error::new(PaddleProviderError::invalid_response(
                        "poll",
                        "Paddle task finished but resultUrl.jsonUrl is missing",
                        task.trace_id.as_deref(),
                    ))
                })
                .map_err(|err| attach_paddle_runtime_error(job, err, "poll"))?;
            let result = client
                .download_jsonl_result(&jsonl_url)
                .await
                .map_err(|err| attach_paddle_runtime_error(job, err, "download"))?;
            ocr_provider_diagnostics_mut(job).artifacts.full_zip_url = Some(jsonl_url.clone());
            let mut payload = result.payload;
            if let Some(meta) = payload.get_mut("_meta").and_then(|v| v.as_object_mut()) {
                meta.insert("provider".to_string(), json!("paddle"));
                meta.insert("taskId".to_string(), json!(job_id));
                meta.insert("jsonlUrl".to_string(), json!(jsonl_url));
                meta.insert(
                    "traceId".to_string(),
                    json!(task.trace_id.clone().unwrap_or_default()),
                );
            }
            persist_provider_result(job, provider_result_json_path, &payload).await?;
            if let Some(markdown_path) =
                materialize_paddle_markdown_artifacts(&payload, job_root).await?
            {
                job.append_log(&format!("published markdown: {}", markdown_path.display()));
            }
            return Ok(());
        }
        if item.state == "failed" {
            let err = anyhow::Error::new(PaddleProviderError::provider_failed(
                item.error_msg.trim(),
                task.trace_id.as_deref(),
            ));
            return Err(attach_paddle_runtime_error(job, err, "poll"));
        }
        wait_next_poll_or_timeout(started, timeout_secs, poll_interval, || {
            format!("Timed out waiting for Paddle task {}", job_id)
        })
        .await
        .map_err(|_err| {
            let err = anyhow::Error::new(PaddleProviderError::poll_timeout(&job_id));
            attach_paddle_runtime_error(job, err, "poll")
        })?;
    }
}

fn log_paddle_unsupported_options(job: &mut JobRuntimeState) {
    if job.request_payload.ocr.disable_formula {
        job.append_log("paddle provider note: disable_formula is not supported by rust_api transport and will be ignored");
    }
    if job.request_payload.ocr.disable_table {
        job.append_log("paddle provider note: disable_table is not supported by rust_api transport and will be ignored");
    }
    if !job.request_payload.ocr.extra_formats.trim().is_empty() {
        job.append_log("paddle provider note: extra_formats is not supported and will be ignored");
    }
}

/// Paddle 服务端按文件内容指纹复用解析结果（同一文件重复提交会在几秒内返回
/// 相同结果），且其异步接口没有缓存开关。彻底重跑（no_cache）时给上传字节
/// 追加惰性 PDF 尾注释，使服务端视为新文件重新解析；返回临时副本路径，
/// 提交完成后由调用方删除。
fn prepare_paddle_submit_path(job: &mut JobRuntimeState, upload_path: &Path) -> (PathBuf, Option<PathBuf>) {
    if !job.request_payload.ocr.no_cache {
        return (upload_path.to_path_buf(), None);
    }
    match build_cache_busted_upload_copy(upload_path) {
        Ok(temp_path) => {
            job.append_log(
                "paddle provider note: no_cache enabled, submitting a cache-busted upload copy to bypass provider-side result reuse",
            );
            (temp_path.clone(), Some(temp_path))
        }
        Err(err) => {
            job.append_log(&format!(
                "paddle provider note: failed to build cache-busted upload copy ({err}); submitting the original file"
            ));
            (upload_path.to_path_buf(), None)
        }
    }
}

fn build_cache_busted_upload_copy(upload_path: &Path) -> Result<PathBuf> {
    let mut bytes = std::fs::read(upload_path)?;
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    bytes.extend_from_slice(
        format!("\n% retain-pdf no-cache bust {}-{}\n", std::process::id(), unique).as_bytes(),
    );
    let temp_path = std::env::temp_dir().join(format!(
        "retainpdf-paddle-nocache-{}-{}.pdf",
        std::process::id(),
        unique
    ));
    std::fs::write(&temp_path, bytes)?;
    Ok(temp_path)
}

#[cfg(test)]
mod tests {
    use super::build_cache_busted_upload_copy;

    #[test]
    fn cache_busted_copy_appends_inert_comment_and_keeps_original() {
        let dir = std::env::temp_dir().join(format!(
            "retainpdf-paddle-nocache-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.pdf");
        let original = b"%PDF-1.7 fake-body\n%%EOF".to_vec();
        std::fs::write(&source, &original).unwrap();

        let copy = build_cache_busted_upload_copy(&source).unwrap();
        let copied = std::fs::read(&copy).unwrap();
        assert!(copied.starts_with(&original));
        assert!(copied.len() > original.len());
        assert!(String::from_utf8_lossy(&copied).contains("retain-pdf no-cache bust"));
        assert_eq!(std::fs::read(&source).unwrap(), original);

        std::fs::remove_file(&copy).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cache_busted_copies_have_unique_bytes() {
        let dir = std::env::temp_dir().join(format!(
            "retainpdf-paddle-nocache-test-uniq-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.pdf");
        std::fs::write(&source, b"%PDF-1.7\n%%EOF").unwrap();

        let first = build_cache_busted_upload_copy(&source).unwrap();
        let second = build_cache_busted_upload_copy(&source).unwrap();
        let first_bytes = std::fs::read(&first).unwrap();
        let second_bytes = std::fs::read(&second).unwrap();
        assert_ne!(first_bytes, second_bytes);

        std::fs::remove_file(&first).unwrap();
        std::fs::remove_file(&second).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
