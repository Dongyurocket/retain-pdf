# 本地启动与配置

## 后端

从仓库根目录启动：

```bash
cd /path/to/retain-pdf/backend/rust_api
RUST_API_BIND_HOST=0.0.0.0 \
RUST_API_DATA_ROOT=../../data \
RUST_API_SCRIPTS_DIR=../scripts \
cargo run
```

默认监听：

- 完整 API：`http://127.0.0.1:41000`
- multipart 异步提交 API：`http://127.0.0.1:42000`

## 前端

```bash
cd /path/to/retain-pdf/frontend
python3 -m http.server 40001 --bind 0.0.0.0
```

前端 API base 规则：

- 优先读取 `window.__FRONT_RUNTIME_CONFIG__.apiBase`。
- 如果没有配置，回落到当前 host 的 `41000`。
- Docker 交付默认 `FRONT_API_BASE=` 为空，由 Nginx 同源 `/api/` 代理到后端。

## 鉴权

除 `GET /health` 外，其余 API 默认需要：

```http
X-API-Key: your-rust-api-key
```

`X-API-Key` 是访问 Rust API 的后端白名单 key，不是 DeepSeek / MinerU / Paddle 的模型或 OCR key。

本地 key 来源：

- `backend/rust_api/auth.local.json`
- 环境变量 `RUST_API_KEYS`

Docker 中 `docker/delivery/docker/auth.local.json` 的 `api_keys` 必须和 `docker/delivery/docker/web.env` 里的 `FRONT_X_API_KEY` 对上。

桌面端动态端口（v4.3.8 起）：

- 主 API、multipart、AI 服务三个端口都由桌面端在启动时按候选顺序做真实 bind 探测，取第一个可绑定端口，而不是钉死固定值。这是为了应对 Windows 上 Hyper-V/WSL2/Docker Desktop 的 HNS 开机成块保留动态端口（被保留的端口 bind 报 10048 但 netstat 查不到占用，connect 探测会误判为空闲）。
- 候选顺序：主 API `41000 → 上次成功端口 → 41200-41203`；multipart `42000 → 41001-41004`；AI `41100 → 41300-41302`。
- 显式固定：`RETAINPDF_DESKTOP_API_PORT` / `RETAINPDF_DESKTOP_SIMPLE_PORT` / `RETAINPDF_DESKTOP_AI_PORT`（设置后只试该端口，失败即报错）。
- 实际端口写入 `userData/runtime-ports.json`（Windows 为 `%APPDATA%\retain-pdf-desktop\runtime-ports.json`，Electron userData 取 package.json 的 name；MCP 同时兼容 `RetainPDF` 目录名），桌面端退出时删除；MCP 桥与任何外部消费者都应读该文件并自行 `/health` 验证，而不是硬编码端口。
- 前端 apiBase 由主进程在运行时注入（`desktop-config.js` → IPC → `setRuntimeConfig`），无需跟随端口变化。

其他常用环境变量：

- `RUST_API_ROOT`：Rust API 根目录。
- `RUST_API_PROJECT_ROOT`：项目根目录。
- `RUST_API_BIND_HOST`：监听地址，默认 `0.0.0.0`。
- `RUST_API_PORT`：完整 API 端口，默认 `41000`（桌面端动态解析后通过该变量注入实际值）。
- `RUST_API_SIMPLE_PORT`：multipart 异步提交端口，默认 `42000`（同上）。
- `RETAINPDF_DESKTOP_SIMPLE_PORT`：仅桌面端使用，显式固定 multipart 提交端口；不设置时按上方候选顺序解析。
- `RUST_API_DATA_ROOT`：运行时数据根目录。
- `RUST_API_DATA_DIR`：旧别名，仅在 `RUST_API_DATA_ROOT` 未设置时使用。
- `RUST_API_SCRIPTS_DIR`：Python 脚本目录。
- `PYTHON_BIN`：Python 可执行文件。
- `RUST_API_UPLOAD_MAX_BYTES`：普通上传大小限制，`0` 表示不限制。
- `RUST_API_UPLOAD_MAX_PAGES`：普通上传页数限制，`0` 表示不限制。
- `RUST_API_MAX_RUNNING_JOBS`：最大并发任务数。

## Docker 配置位置

Compose 实际读取的是：

- `docker/delivery/docker/app.env`
- `docker/delivery/docker/web.env`
- `docker/delivery/docker/auth.local.json`

不是仓库根目录下的 `docker/*.env`。
