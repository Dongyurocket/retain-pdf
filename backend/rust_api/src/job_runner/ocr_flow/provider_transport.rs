use anyhow::{anyhow, Result};
use std::future::Future;
use std::pin::Pin;

use crate::models::domain::JobRuntimeState;
use crate::ocr_provider::mineru::MineruClient;
use crate::ocr_provider::paddle::PaddleClient;
use crate::ocr_provider::{provider_definition, OcrProviderKind};

use super::transport::{prepare_local_upload_source, recover_remote_source_pdf};
use super::workspace::OcrWorkspace;
use super::{mineru, paddle};
use crate::job_runner::cancel_registry::is_cancel_requested_with_registry;
use crate::job_runner::ProcessRuntimeDeps;

type TransportFuture<'a> = Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
type LocalTransportFn = for<'a> fn(
    &'a ProcessRuntimeDeps,
    &'a mut JobRuntimeState,
    &'a OcrWorkspace,
    &'a std::path::Path,
    Option<&'a str>,
) -> TransportFuture<'a>;
type RemoteTransportFn = for<'a> fn(
    &'a ProcessRuntimeDeps,
    &'a mut JobRuntimeState,
    &'a OcrWorkspace,
    Option<&'a str>,
) -> TransportFuture<'a>;

struct OcrProviderTransport {
    key: &'static str,
    local: LocalTransportFn,
    remote: RemoteTransportFn,
}

static REGISTERED_TRANSPORTS: &[OcrProviderTransport] = &[
    OcrProviderTransport {
        key: "mineru",
        local: execute_mineru_local_transport,
        remote: execute_mineru_remote_transport,
    },
    OcrProviderTransport {
        key: "paddle",
        local: execute_paddle_local_transport,
        remote: execute_paddle_remote_transport,
    },
];

pub(super) async fn execute_provider_transport(
    deps: &ProcessRuntimeDeps,
    job: &mut JobRuntimeState,
    provider_kind: &OcrProviderKind,
    workspace: &OcrWorkspace,
    parent_job_id: Option<&str>,
) -> Result<std::path::PathBuf> {
    let transport = resolve_provider_transport(provider_kind)?;
    if let Some(upload_path) =
        prepare_local_upload_source(deps.db.as_ref(), job, &workspace.source_dir)?
    {
        (transport.local)(deps, job, workspace, &upload_path, parent_job_id).await?;
        return Ok(upload_path);
    }

    (transport.remote)(deps, job, workspace, parent_job_id).await?;

    if is_cancel_requested_with_registry(deps.canceled_jobs.as_ref(), &job.job_id).await {
        return Ok(std::path::PathBuf::new());
    }

    recover_remote_source_pdf(
        provider_kind,
        job,
        &workspace.source_dir,
        &workspace.provider_raw_dir,
    )
    .await
}

fn resolve_provider_transport(
    provider_kind: &OcrProviderKind,
) -> Result<&'static OcrProviderTransport> {
    let key = provider_definition(provider_kind)
        .map(|definition| definition.key)
        .ok_or_else(|| anyhow!("unsupported OCR provider"))?;
    REGISTERED_TRANSPORTS
        .iter()
        .find(|transport| transport.key == key)
        .ok_or_else(|| anyhow!("{key} OCR provider is only supported by provider stage script"))
}

fn execute_mineru_local_transport<'a>(
    deps: &'a ProcessRuntimeDeps,
    job: &'a mut JobRuntimeState,
    workspace: &'a OcrWorkspace,
    upload_path: &'a std::path::Path,
    parent_job_id: Option<&'a str>,
) -> TransportFuture<'a> {
    Box::pin(async move {
        let client = MineruClient::with_runtime(
            "",
            job.request_payload.ocr.mineru_token.clone(),
            deps.mineru_runtime().clone(),
        );
        mineru::run_local_ocr_transport_mineru(
            deps,
            job,
            &client,
            upload_path,
            &workspace.provider_result_json_path,
            parent_job_id,
        )
        .await
    })
}

fn execute_paddle_local_transport<'a>(
    deps: &'a ProcessRuntimeDeps,
    job: &'a mut JobRuntimeState,
    workspace: &'a OcrWorkspace,
    upload_path: &'a std::path::Path,
    parent_job_id: Option<&'a str>,
) -> TransportFuture<'a> {
    Box::pin(async move {
        let client = PaddleClient::with_runtime(
            job.request_payload.ocr.paddle_api_url.clone(),
            job.request_payload.ocr.paddle_token.clone(),
            deps.paddle_runtime().clone(),
        );
        paddle::run_local_ocr_transport_paddle(
            deps,
            job,
            &client,
            upload_path,
            &workspace.provider_result_json_path,
            &workspace.job_paths.root,
            parent_job_id,
        )
        .await
    })
}

fn execute_mineru_remote_transport<'a>(
    deps: &'a ProcessRuntimeDeps,
    job: &'a mut JobRuntimeState,
    workspace: &'a OcrWorkspace,
    parent_job_id: Option<&'a str>,
) -> TransportFuture<'a> {
    Box::pin(async move {
        let client = MineruClient::with_runtime(
            "",
            job.request_payload.ocr.mineru_token.clone(),
            deps.mineru_runtime().clone(),
        );
        mineru::run_remote_ocr_transport_mineru(
            deps,
            job,
            &client,
            &workspace.provider_result_json_path,
            parent_job_id,
        )
        .await
    })
}

fn execute_paddle_remote_transport<'a>(
    deps: &'a ProcessRuntimeDeps,
    job: &'a mut JobRuntimeState,
    workspace: &'a OcrWorkspace,
    parent_job_id: Option<&'a str>,
) -> TransportFuture<'a> {
    Box::pin(async move {
        let client = PaddleClient::with_runtime(
            job.request_payload.ocr.paddle_api_url.clone(),
            job.request_payload.ocr.paddle_token.clone(),
            deps.paddle_runtime().clone(),
        );
        paddle::run_remote_ocr_transport_paddle(
            deps,
            job,
            &client,
            &workspace.provider_result_json_path,
            &workspace.source_dir,
            &workspace.job_paths.root,
            parent_job_id,
        )
        .await
    })
}
