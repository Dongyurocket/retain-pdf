use crate::error::AppError;
use crate::models::api::{
    RetryStageKind, RetryStageRequest, RetryStageSubmissionView, StageActionsView,
};
use crate::services::job_launcher::start_job_execution;
use crate::services::jobs::stage_plan::stage_plan;

use super::super::super::creation::create_translation_job;
use super::super::super::query::load_job_or_404;
use super::super::JobsFacade;
use super::rerun::prepare_in_place_render_job;
use super::stage_retry_overrides::{apply_retry_overrides, apply_retry_overrides_to_resolved_spec};
use super::stage_retry_request::build_retry_request;
use super::stage_retry_view::{build_retry_stage_submission_view, build_stage_actions_view};

impl<'a> JobsFacade<'a> {
    pub fn stage_actions_view(
        &self,
        base_url: &str,
        job_id: &str,
    ) -> Result<StageActionsView, AppError> {
        let job = load_job_or_404(self.command.db, job_id)?;
        Ok(build_stage_actions_view(base_url, &job))
    }

    /// 重试即链文档：主页卡片靠 documents.active_job_id 找运行中任务。
    /// 源任务的文档可经 jobs.document_id / upload 反查；找不到就跳过，
    /// 终态 lifecycle 仍会再次对账，绝不影响提交。
    fn link_retry_to_source_document(&self, source_job_id: &str, new_job_id: &str) {
        match self.command.db.get_document_by_job_id(source_job_id) {
            Ok(Some(doc)) => {
                if let Err(error) = self
                    .command
                    .db
                    .set_document_active_job(&doc.document_id, new_job_id, None)
                {
                    tracing::warn!(
                        "library: set active job for {} at retry failed: {error}",
                        doc.document_id
                    );
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(
                    "library: resolve document for retry source {source_job_id} failed: {error}"
                );
            }
        }
    }

    pub fn retry_stage_submission(
        &self,
        base_url: &str,
        source_job_id: &str,
        request: RetryStageRequest,
    ) -> Result<RetryStageSubmissionView, AppError> {
        if !request.mode.trim().is_empty() && request.mode.trim() != "from_stage" {
            return Err(AppError::bad_request(format!(
                "unsupported retry mode: {}",
                request.mode
            )));
        }

        let source_job = load_job_or_404(self.command.db, source_job_id)?;
        let plan = stage_plan(&source_job, request.stage.clone());
        if !plan.can_retry {
            return Err(AppError::bad_request(plan.disabled_reason));
        }

        let request_input = if request.create_new_job {
            build_retry_request(&source_job, &request.stage, request.force_full_reprocess)?
        } else if matches!(request.stage, RetryStageKind::Render) {
            let mut job = prepare_in_place_render_job(source_job)?;
            apply_retry_overrides_to_resolved_spec(&mut job.request_payload, &request.overrides)?;
            job.request_payload.runtime.job_id = job.job_id.clone();
            job.sync_runtime_state();
            let job = start_job_execution(&self.command.submit.launcher, job)?;
            self.link_retry_to_source_document(source_job_id, &job.job_id);
            return Ok(build_retry_stage_submission_view(
                base_url,
                source_job_id,
                &job,
                RetryStageKind::Render,
                plan.will_reuse,
                plan.will_rerun,
                plan.retry_workflow,
            ));
        } else {
            return Err(AppError::bad_request(
                "create_new_job=false is currently supported only for render retry",
            ));
        };

        let mut request_input = request_input;
        apply_retry_overrides(&mut request_input, &request.overrides)?;
        if request.force_full_reprocess {
            request_input.ocr.no_cache = true;
            request_input.translation.options.insert(
                "bypass_cache".to_string(),
                serde_json::Value::Bool(true),
            );
        }
        let workflow = request_input.workflow.clone();
        let job = create_translation_job(&self.command.submit, &request_input)?;
        self.link_retry_to_source_document(source_job_id, &job.job_id);
        Ok(build_retry_stage_submission_view(
            base_url,
            source_job_id,
            &job,
            request.stage,
            plan.will_reuse,
            plan.will_rerun,
            workflow,
        ))
    }
}
