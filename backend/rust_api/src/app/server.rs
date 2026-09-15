use std::future::pending;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::app::cleanup::{
    log_startup_settings, run_cleanup_once, spawn_periodic_cleanup, RetentionSettings,
};
use crate::app::{build_app, build_simple_app, build_state};
use crate::config::AppConfig;

pub struct RunningServers {
    pub base_url: String,
    pub simple_base_url: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    join_handle: JoinHandle<Result<()>>,
}

impl RunningServers {
    pub async fn shutdown(mut self) -> Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.join_handle.await?
    }
}

async fn bind_listener(addr: SocketAddr, role: &str) -> Result<tokio::net::TcpListener> {
    tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| {
            format!(
                "failed to bind {role} on {addr}: the port is unavailable. \
                 On Windows it may be reserved by Hyper-V/WSL2/Docker even with no listener \
                 (check `netsh int ipv4 show excludedportrange protocol=tcp`); \
                 set RUST_API_PORT / RUST_API_SIMPLE_PORT to use a different port"
            )
        })
}

async fn serve_with_shutdown(
    config: Arc<AppConfig>,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let state = build_state(config.clone())?;

    // Retention/cleanup is operational maintenance, not startup correctness
    // (unlike `reconcile_stale_running_jobs`/`cleanup_legacy_workflows`
    // inside `build_state`), so it only runs here - once when the real
    // server actually starts serving - rather than in `build_state` itself,
    // which is also called directly by many unit tests that don't want
    // background retention sweeps touching their fixtures.
    let retention_settings = RetentionSettings::from_env();
    log_startup_settings(&retention_settings);
    if let Err(error) = run_cleanup_once(&retention_settings, state.db.as_ref()) {
        tracing::warn!("startup retention cleanup sweep failed: {error:#}");
    }
    let _cleanup_handle = spawn_periodic_cleanup(retention_settings, state.db.clone());

    let app = build_app(state.clone());
    let simple_app = build_simple_app(state);

    let bind_ip: IpAddr = config.bind_host.parse()?;
    let addr = SocketAddr::new(bind_ip, config.port);
    let simple_addr = SocketAddr::new(bind_ip, config.simple_port);
    tracing::info!(
        "rust_api auth enabled: {} keys, max running jobs: {}",
        config.api_keys.len(),
        config.max_running_jobs
    );

    // 绑定失败时必须说清是哪个端口、哪个角色：两个监听口里任意一个绑不上都会让
    // 进程整体退出，而桌面端只在等 full api 就绪，光看 os error 10048 无法定位。
    // 日志放在 bind 之后，避免打印了 "listening on" 其实什么都没绑上。
    let listener = bind_listener(addr, "full api").await?;
    let simple_listener = bind_listener(simple_addr, "simple api").await?;
    tracing::info!("rust_api full api listening on {}", addr);
    tracing::info!("rust_api simple api listening on {}", simple_addr);

    let shutdown_signal = Arc::new(tokio::sync::Notify::new());
    let shutdown_waiter = shutdown_signal.clone();
    tokio::spawn(async move {
        shutdown.await;
        shutdown_waiter.notify_waiters();
    });

    let full_server = axum::serve(listener, app).with_graceful_shutdown({
        let shutdown_signal = shutdown_signal.clone();
        async move { shutdown_signal.notified().await }
    });
    let simple_server = axum::serve(simple_listener, simple_app)
        .with_graceful_shutdown(async move { shutdown_signal.notified().await });

    tokio::try_join!(full_server, simple_server)?;
    Ok(())
}

pub async fn run_servers(config: AppConfig) -> Result<()> {
    serve_with_shutdown(Arc::new(config), pending()).await
}

pub async fn run_servers_with_shutdown(
    config: AppConfig,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    serve_with_shutdown(Arc::new(config), shutdown).await
}

pub fn spawn_servers(config: AppConfig) -> RunningServers {
    let base_url = format!("http://127.0.0.1:{}", config.port);
    let simple_base_url = format!("http://127.0.0.1:{}", config.simple_port);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let config = Arc::new(config);
    let join_handle = tokio::spawn(async move {
        serve_with_shutdown(config, async move {
            let _ = shutdown_rx.await;
        })
        .await
    });

    RunningServers {
        base_url,
        simple_base_url,
        shutdown_tx: Some(shutdown_tx),
        join_handle,
    }
}
