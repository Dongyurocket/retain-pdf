use crate::error::AppError;
use crate::models::api::RetryStageKind;
use crate::models::domain::{CreateJobInput, JobSnapshot, WorkflowKind};
use crate::models::request::JobSourceInput;

pub(super) fn build_retry_request(
    source_job: &JobSnapshot,
    stage: &RetryStageKind,
    force_full_reprocess: bool,
) -> Result<CreateJobInput, AppError> {
    let artifacts = source_job
        .artifacts
        .as_ref()
        .ok_or_else(|| AppError::bad_request("source job has no reusable artifacts"))?;
    let workflow = match stage {
        RetryStageKind::Ocr => WorkflowKind::Book,
        RetryStageKind::Translation => WorkflowKind::Book,
        RetryStageKind::Render => WorkflowKind::Render,
    };
    let mut request = CreateJobInput {
        workflow,
        source: JobSourceInput::default(),
        ocr: source_job.request_payload.ocr.clone(),
        translation: source_job.request_payload.translation.clone(),
        render: source_job.request_payload.render.clone(),
        runtime: source_job.request_payload.runtime.clone(),
    };
    match stage {
        RetryStageKind::Ocr => {
            request.source.upload_id = source_job.request_payload.source.upload_id.clone();
            request.source.source_url = source_job.request_payload.source.source_url.clone();
            require_request_source(&request)?;
        }
        RetryStageKind::Translation => {
            require_artifact(
                artifacts.normalized_document_json.as_ref(),
                "normalized_document_json",
            )?;
            require_artifact(artifacts.source_pdf.as_ref(), "source_pdf")?;
            request.source.artifact_job_id = source_job.job_id.clone();
        }
        RetryStageKind::Render => {
            require_artifact(artifacts.translations_dir.as_ref(), "translations_dir")?;
            require_artifact(artifacts.source_pdf.as_ref(), "source_pdf")?;
            request.source.artifact_job_id = source_job.job_id.clone();
        }
    }
    request.runtime.job_id.clear();
    if force_full_reprocess {
        request.ocr.no_cache = true;
        request
            .translation
            .options
            .insert("bypass_cache".to_string(), serde_json::Value::Bool(true));
    }
    Ok(request)
}

fn require_request_source(request: &CreateJobInput) -> Result<(), AppError> {
    if !request.source.upload_id.trim().is_empty() || !request.source.source_url.trim().is_empty() {
        return Ok(());
    }
    Err(AppError::bad_request(
        "OCR retry requires the original upload_id or source_url",
    ))
}

fn require_artifact(value: Option<&String>, name: &str) -> Result<(), AppError> {
    if value.as_ref().is_some_and(|item| !item.trim().is_empty()) {
        return Ok(());
    }
    Err(AppError::bad_request(format!(
        "source job missing required artifact: {name}"
    )))
}

#[cfg(test)]
mod tests {
    use super::build_retry_request;
    use crate::models::api::RetryStageKind;
    use crate::models::domain::{CreateJobInput, JobSnapshot, WorkflowKind};

    #[test]
    fn forced_ocr_retry_disables_ocr_and_translation_cache_reuse() {
        let mut input = CreateJobInput::default();
        input.workflow = WorkflowKind::Book;
        input.source.source_url = "https://example.test/source.pdf".to_string();
        let source = JobSnapshot::new(
            "job-force-rerun-source".to_string(),
            input,
            vec!["noop".to_string()],
        );

        let request = build_retry_request(&source, &RetryStageKind::Ocr, true)
            .expect("forced OCR retry request");

        assert_eq!(request.workflow, WorkflowKind::Book);
        assert_eq!(request.source.source_url, "https://example.test/source.pdf");
        assert!(request.ocr.no_cache);
        assert_eq!(
            request.translation.options.get("bypass_cache"),
            Some(&serde_json::Value::Bool(true))
        );
    }
}
