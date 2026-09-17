use super::*;
use crate::services::library::{delete_library_book, LibraryDeps};
use crate::{
    config::AppConfig,
    db::Db,
    models::{
        domain::{JobSnapshot, WorkflowKind},
        request::CreateJobInput,
    },
};
use std::{collections::HashSet, fs, sync::Arc};
use tokio::sync::{RwLock, Semaphore};

fn minimal_pdf_bytes() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>",
    ];
    let mut bytes = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0usize];
    for (idx, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", idx + 1, object).as_bytes());
    }
    let xref_offset = bytes.len();
    bytes.extend_from_slice(format!("xref\n0 {}\n", offsets.len()).as_bytes());
    bytes.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            offsets.len(),
            xref_offset
        )
        .as_bytes(),
    );
    bytes
}

#[tokio::test]
async fn running_translation_spawn_failure_allows_document_delete_route() {
    use crate::{job_events::persist_runtime_job_with_resources, models::domain::UploadRecord};
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use tower::util::ServiceExt;

    let deps = test_deps("workflow-document-delete");
    let source = deps.config.uploads_dir.join("upload-workflow/source.pdf");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    let pdf = minimal_pdf_bytes();
    fs::write(&source, &pdf).unwrap();
    let document_id = crate::db::documents::sha256_hex(&pdf);
    let upload = UploadRecord {
        upload_id: "upload-workflow".into(),
        filename: "source.pdf".into(),
        stored_path: source.to_string_lossy().into_owned(),
        bytes: pdf.len() as u64,
        page_count: 1,
        uploaded_at: now_iso(),
        developer_mode: false,
        content_hash: document_id.clone(),
    };
    deps.db.save_upload(&upload).unwrap();
    deps.db.upsert_document_from_upload(&upload).unwrap();
    let mut parent =
        JobSnapshot::new("workflow-book".into(), CreateJobInput::default(), vec![]).into_runtime();
    parent.status = JobStatusKind::Running;
    parent.upload_id = Some(upload.upload_id.clone());
    parent.request_payload.source.upload_id = upload.upload_id.clone();
    parent.request_payload.ocr.provider = "local".into();
    parent.request_payload.runtime.job_id = parent.job_id.clone();
    parent.sync_runtime_state();
    persist_runtime_job_with_resources(
        deps.db.as_ref(),
        &deps.persist.data_root,
        &deps.persist.output_root,
        &parent,
    )
    .unwrap();
    deps.db
        .link_job_to_document(&parent.job_id, &upload.upload_id)
        .unwrap();
    assert_eq!(
        deps.db.get_job(&parent.job_id).unwrap().status,
        JobStatusKind::Running
    );

    let finished =
        crate::job_runner::translation_flow::run_translation_job_with_ocr(deps.clone(), parent)
            .await
            .unwrap();
    assert_eq!(finished.status, JobStatusKind::Failed);
    assert!(finished.finished_at.is_some());
    let child = deps.db.get_job("workflow-book-ocr").unwrap().into_runtime();
    assert_eq!(child.status, JobStatusKind::Failed);
    assert!(child
        .error
        .as_deref()
        .unwrap()
        .contains("nonexistent-worker-executable"));
    assert!(child.pid.is_none());
    // The lifecycle persists the returned workflow result after execution completes.
    persist_runtime_job_with_resources(
        deps.db.as_ref(),
        &deps.persist.data_root,
        &deps.persist.output_root,
        &finished,
    )
    .unwrap();
    assert_eq!(
        deps.db.get_job("workflow-book").unwrap().status,
        JobStatusKind::Failed
    );

    let app = crate::app::build_app(crate::AppState {
        config: deps.config.clone(),
        db: deps.db.clone(),
        downloads_lock: Arc::new(tokio::sync::Mutex::new(())),
        canceled_jobs: deps.canceled_jobs.clone(),
        job_slots: deps.job_slots.clone(),
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/documents/{document_id}"))
                .header("X-API-Key", "test-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["data"]["deleted"], true);
    assert!(deps.db.get_job("workflow-book").is_err());
    assert!(deps.db.get_job("workflow-book-ocr").is_err());
    assert!(deps.db.get_document(&document_id).is_err());
    assert!(deps.db.get_upload(&upload.upload_id).is_err());
    assert!(!source.exists());
}

fn test_deps(name: &str) -> ProcessRuntimeDeps {
    let root = std::env::temp_dir().join(format!(
        "retainpdf-ocr-failure-{name}-{}-{}",
        std::process::id(),
        now_iso().replace([':', '.'], "-")
    ));
    let scripts = root.join("scripts");
    let data = root.join("data");
    for path in [
        &scripts,
        &data.join("jobs"),
        &data.join("db"),
        &data.join("downloads"),
        &data.join("uploads"),
    ] {
        fs::create_dir_all(path).unwrap();
    }
    let config = Arc::new(AppConfig {
        project_root: root.clone(),
        rust_api_root: root.join("rust_api"),
        data_root: data.clone(),
        scripts_dir: scripts.clone(),
        run_provider_case_script: scripts.join("run_provider_case.py"),
        run_provider_ocr_script: scripts.join("run_provider_ocr.py"),
        run_normalize_ocr_script: scripts.join("run_normalize_ocr.py"),
        run_translate_from_ocr_script: scripts.join("run_translate_from_ocr.py"),
        run_translate_only_script: scripts.join("run_translate_only.py"),
        run_render_only_script: scripts.join("run_render_only.py"),
        run_failure_ai_diagnosis_script: scripts.join("diagnose_failure_with_ai.py"),
        uploads_dir: data.join("uploads"),
        downloads_dir: data.join("downloads"),
        jobs_db_path: data.join("db/jobs.db"),
        output_root: data.join("jobs"),
        python_bin: root
            .join("nonexistent-worker-executable")
            .to_string_lossy()
            .into_owned(),
        python_entrypoint_mode: crate::config::PythonWorkerEntrypointMode::Script,
        bind_host: "127.0.0.1".into(),
        port: 41000,
        simple_port: 41001,
        upload_max_bytes: 0,
        upload_max_pages: 0,
        api_keys: HashSet::from(["test-key".to_string()]),
        max_running_jobs: 1,
        provider_limits: Default::default(),
        provider_runtime: Default::default(),
        job_runner: Default::default(),
    });
    let db = Arc::new(Db::new(config.jobs_db_path.clone(), data));
    db.init().unwrap();
    ProcessRuntimeDeps::new(
        config,
        db,
        Arc::new(RwLock::new(HashSet::new())),
        Arc::new(Semaphore::new(1)),
    )
}

fn child_and_parent(deps: &ProcessRuntimeDeps) -> JobRuntimeState {
    let mut parent = JobSnapshot::new("book".into(), CreateJobInput::default(), vec![]);
    parent.status = JobStatusKind::Failed;
    deps.db.save_job(&parent).unwrap();
    let mut child =
        JobSnapshot::new("book-ocr".into(), CreateJobInput::default(), vec![]).into_runtime();
    child.workflow = WorkflowKind::Ocr;
    child.request_payload.ocr.provider = "local".into();
    child.request_payload.runtime.job_id = child.job_id.clone();
    child
}

fn assert_deletable(deps: &ProcessRuntimeDeps) {
    let result = delete_library_book(
        &LibraryDeps {
            db: deps.db.as_ref(),
            data_root: &deps.persist.data_root,
            output_root: &deps.persist.output_root,
            downloads_dir: &deps.persist.data_root.join("downloads"),
            scripts_dir: &deps.persist.data_root,
            python_bin: "unused",
        },
        "book",
        false,
    )
    .expect("terminal OCR child must not block normal deletion");
    assert!(result.deleted);
    assert_eq!(result.removed_child_jobs, vec!["book-ocr"]);
    assert!(deps.db.get_job("book").is_err());
    assert!(deps.db.get_job("book-ocr").is_err());
}

#[tokio::test]
async fn setup_failure_persists_failed_child_and_allows_normal_delete() {
    let deps = test_deps("setup");
    let mut child = child_and_parent(&deps);
    child.request_payload.source.upload_id = "missing-upload".into();
    let result = execute_ocr_job(deps.clone(), child, None, Some("book".into()))
        .await
        .unwrap();
    assert_eq!(result.status, JobStatusKind::Failed);
    let saved = deps.db.get_job("book-ocr").unwrap().into_runtime();
    assert_eq!(saved.status, JobStatusKind::Failed);
    assert!(saved.error.is_some());
    assert!(saved.finished_at.is_some());
    assert!(saved.pid.is_none());
    assert_deletable(&deps);
}

#[tokio::test]
async fn spawn_failure_persists_failed_child_and_allows_normal_delete() {
    let deps = test_deps("spawn");
    let child = child_and_parent(&deps);
    assert!(
        is_configured_command_provider("local"),
        "local provider must exercise process spawn"
    );
    let result = execute_ocr_job(deps.clone(), child, None, Some("book".into()))
        .await
        .unwrap();
    assert_eq!(result.status, JobStatusKind::Failed);
    let saved = deps.db.get_job("book-ocr").unwrap().into_runtime();
    assert_eq!(saved.status, JobStatusKind::Failed);
    assert!(
        !saved.command.is_empty(),
        "command construction must have completed"
    );
    assert!(saved
        .error
        .as_deref()
        .unwrap()
        .contains("nonexistent-worker-executable"));
    assert!(saved.finished_at.is_some());
    assert!(saved.pid.is_none());
    assert_deletable(&deps);
}

#[tokio::test]
async fn setup_failure_preserves_parent_cancellation() {
    for registered in [false, true] {
        let deps = test_deps(if registered {
            "parent-registry-canceled"
        } else {
            "parent-db-canceled"
        });
        let mut child = child_and_parent(&deps);
        child.request_payload.source.upload_id = "missing-upload".into();
        let mut parent = deps.db.get_job("book").unwrap();
        parent.status = JobStatusKind::Canceled;
        deps.db.save_job(&parent).unwrap();
        if registered {
            deps.canceled_jobs.write().await.insert("book".into());
            // Registry-only cancellation may precede the lifecycle's terminal write.
            parent.status = JobStatusKind::Running;
            deps.db.save_job(&parent).unwrap();
        }
        let finished = execute_ocr_job(deps.clone(), child, None, Some("book".into()))
            .await
            .unwrap();
        assert_eq!(finished.status, JobStatusKind::Canceled);
        assert_eq!(
            deps.db.get_job("book-ocr").unwrap().status,
            JobStatusKind::Canceled
        );
        assert!(finished.error.is_none());
        assert!(finished.pid.is_none());
        if !registered {
            assert_eq!(
                deps.db.get_job("book").unwrap().status,
                JobStatusKind::Canceled
            );
        } else {
            assert!(deps.canceled_jobs.read().await.contains("book"));
            assert_ne!(
                deps.db.get_job("book").unwrap().status,
                JobStatusKind::Failed
            );
        }
    }
}

#[tokio::test]
async fn setup_failure_preserves_requested_cancellation() {
    let deps = test_deps("canceled");
    let mut child = child_and_parent(&deps);
    child.request_payload.source.upload_id = "missing-upload".into();
    deps.canceled_jobs
        .write()
        .await
        .insert(child.job_id.clone());
    let result = execute_ocr_job(deps.clone(), child, None, Some("book".into()))
        .await
        .unwrap();
    assert_eq!(result.status, JobStatusKind::Canceled);
    let saved = deps.db.get_job("book-ocr").unwrap().into_runtime();
    assert_eq!(saved.status, JobStatusKind::Canceled);
    assert!(saved.error.is_none());
    assert!(saved.pid.is_none());
    assert!(saved.finished_at.is_some());
    assert_deletable(&deps);
}
