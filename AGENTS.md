# RetainPDF 项目地图（Proma 维护）

PDF 保留排版翻译全栈项目：扫描/图片型 PDF、行内公式渲染是核心场景。前后端分离：Rust API + Python OCR/翻译/渲染流水线 + 前端 SPA + Electron 桌面端 + Docker 交付。

<!-- proma:project-map:start -->
## 架构与目录

- `backend/rust_api/`：Rust API 服务（Cargo）。负责任务状态、stage spec、事件流、artifact 引用、图书馆和进程编排。关键契约文档见该目录根：`API_SPEC.md`、`RUST_API_ARCHITECTURE.md`、`STAGE_EXECUTION_CONTRACT.md`、`OCR_PROVIDER_CONTRACT.md` 等。
- `backend/scripts/`：Python 流水线。分层：`runtime/`（pipeline 编排）、`services/`（OCR/翻译/渲染实现）、`foundation/`（配置/共享工具）、`entrypoints/`（人工入口）、`devtools/`（测试探针、诊断、架构检查）。主链路：`PDF -> OCR provider -> document.v1.json -> translation -> rendering -> PDF`（stage：`normalize.stage.v1` -> `translate.stage.v1` -> `render.stage.v1`，整书由 `book.stage.v1` 编排）。
- `backend/packages/`：可编辑安装包 `retainpdf-core`、`retainpdf-devtools`（打包迁移中，测试正向 `backend/python-tests/` 迁移）。
- `backend/fonts/`：正式发布字体资源（非缓存）。
- `frontend/`：当前生产前端，三页 React SPA（index/reader/detail，`src/pages/`，esbuild 打包，Tailwind 4）；`frontend-react/` 是另一条独立技术栈（Vite+TS）迁移区，不替代 `frontend/`。
- `desktop/`：Electron 桌面端打包与运行壳。
- `docker/`：Dockerfile 与交付 compose（`docker/delivery/`）。
- `mcp/`：stdio MCP 桥（`retainpdf_mcp.py`，Python 3.14），向本地 RetainPDF Docker 部署暴露 14 个工具（健康检查、上传/建任务、轮询/事件、产物下载、Markdown 读取、取消、图书馆、阅读问答），凭据在 `secrets/retainpdf-mcp.json`（不提交）。
- `doc/`：文档库，入口 `doc/README.md`（api / core 主线 / reference / ops 四大类）。
- `experiments/`：独立实验与 POC；`data/`：本地运行输出与样本（不入库）。

## 常用命令

- Rust API 本地启动（仓库根）：`cd backend/rust_api && RUST_API_DATA_ROOT=<abs data> RUST_API_SCRIPTS_DIR=<abs scripts> cargo run`（DATA_ROOT/SCRIPTS_DIR 建议绝对路径）。
- 前端静态服务：`cd frontend && python3 -m http.server 40001`；构建 `npm run build`（css+js+version），类型检查 `npm run typecheck`，测试 `npm test`，视觉回归 `npm run visual:check`。
- Python 测试：`python backend/python-tests/run_python_tests.py [可选测试路径]`（默认收集 `backend/python-tests` 与 `backend/scripts/devtools/tests`）；先 `pip install -e backend/packages/retainpdf-core` 与 `-e backend/packages/retainpdf-devtools --no-build-isolation`。
- 架构门禁（新增跨层依赖前必跑）：
  - `python3 backend/scripts/devtools/check_pipeline_architecture.py`
  - `python3 backend/scripts/devtools/check_stage_specs_contract.py data/jobs`
- 默认端口：Web 前端 40001、Rust API 41000、multipart 提交 42000（本地 Docker override 部署为 44001/44002/44003，见 `mcp/README.md`）。
- 前端验证基线（2026-09-06）：`npm test` 共 738 项，733 通过、5 个存量失败；失败项与此前一致（架构边界 4 项、CSS 字面色值棘轮 1 项），本轮无新增失败。`npm run typecheck` 已清零（0 错误，exit code 0）。另观察到 Rust API 在 Windows 本机有 2 个存量测试失败（`worker_command` spec 路径分隔符断言、`store_pdf_upload` 反斜杠穿越断言），与代码变更无关，为平台差异类存量问题。

## 本机部署事实（已验证）

- 本机 `41000/42000` 被 RetainPDF 桌面端 `rust_api.exe` 常驻占用；Docker 实例固定用 `44001`（Web）/ `44002`（Rust API）/ `44003`（simple API），且只绑定 `127.0.0.1`，不暴露局域网。
- MCP 桥通过 `http://127.0.0.1:44001` 的 Web 同源代理访问业务 API；Docker Desktop/WSL 下宿主直连 `44002` 鉴权异常，不要改回直连。
- 本机密钥（均不提交）：`secrets/retainpdf-mcp.json`、`secrets/retainpdf-web.env`、`secrets/retainpdf-app.env`、`secrets/auth.local.json`。
- 起停：`docker compose -f docker/delivery/docker-compose.yml -f docker/delivery/docker-compose.override.yml up -d`（override 文件被 gitignore）。

## 发布与更新检测（个人 Fork 模式，2026-08-25 验证）

- 发布流：在 `main` 上迭代 `desktop/package.json` version 并同步更新 `CHANGELOG.md`，打 `vX.Y.Z` tag 推送 `origin`（Dongyurocket/retain-pdf），触发 `.github/workflows/release-desktop.yml` 三平台构建并上传 Release；用 `gh release edit` 补发布说明。
- 更新检测：前端 `src/js/features/app-update/github-release.ts` 查询 `api.github.com/repos/${GITHUB_REPO}/releases/latest`；`GITHUB_REPO` 由 `frontend/scripts/generate-app-version.mjs` 从 `desktop/package.json` 的 `homepage` 生成（v4.1.11 起指向 Dongyurocket/retain-pdf，此前为上游 wxyhgk/retain-pdf）。旧安装包仍查上游，只有新构建才查 Fork。
- Fork 注意：GitHub 对新 Fork 默认抑制事件触发的 Actions，需 `gh api -X PUT repos/<owner>/<repo>/actions/permissions -F enabled=true -F allowed_actions=all` 解除一次（workflow_dispatch 不受限）；`release-docker.yml` 同样响应 `v*` tag，Fork 无 Docker Hub 凭据会失败（噪音，不影响桌面 Release）。

## 环境要求

- Python `>=3.11,<3.12`（`pyproject.toml`，包名 `retainpdf-backend`）；外部二进制：`typst` 必需、`gs` 可选。
- 注意：Proma MCP 桥用系统 `C:/Python314/python.exe` 运行，仅服务 MCP 桥本身；流水线代码仍以 3.11 为准。
- Rust 工具链（rust_api 为 Cargo 工程）；前端需 Node（esbuild/tsc 脚本）。

## 边界与红线

- Python `runtime/pipeline/` 只做阶段编排，不消费 OCR provider 原始结构；翻译走 `services.translation.workflow` facade；渲染源预处理走 `services.rendering.source.*`。
- OCR 原始产物先归一化为 `ocr/normalized/document.v1.json`，翻译/渲染只消费 normalized document 与 translation artifacts；是否进翻译以 `policy.translate` 为准。
- 不提交：`backend/scripts/.env/*.env`、`backend/rust_api/auth.local.json`、`secrets/`、`backend/rust_api/target/`、`backend/python/`、`backend/typst-win32/bin/`。
- `backend/` 含运行时产物（target、嵌入式 python、typst-win32），不要当纯源码目录整体移动；整理方向见 `backend/README.md`。

## 关键文档索引

- 总入口：`README.md`、`CHANGELOG.md`（Fork 相对上游的变更与发布记录）、`CONTRIBUTING.md`、`doc/README.md`
- 后端：`backend/README.md`（目录边界）、`backend/scripts/README.md`（流水线契约）、`backend/rust_api/`（API 契约族）
- 测试：`backend/python-tests/README.md`
- MCP：`mcp/README.md`
<!-- proma:project-map:end -->

<!-- proma:knowledge-maintenance:start -->
## 协作知识演进（Proma 维护）

- 保持本文件中的项目地图与已验证项目事实同步；命令、架构、边界和入口变化时做最小更新，不复制到协作记忆。
- Proma 工作区的 `memory/` 是可扩展的长期协作知识库：`MEMORY.md` 只做主题索引和路由，按证据创建用户画像、协作偏好、纠错与经验、决策理由等主题文件；不要把临时过程或长篇证据写入其中。
- 用户画像按具体领域渐进修订，不以“新手/专家”等全局标签定性。只有稳定、会改变未来协作判断的信息才值得维护。
- 基于明确、稳定证据的 Memory 最小增量可直接写入并在完成后说明；仅在删除或大段覆盖、与既有记录冲突、存在不确定推断，或可能涉及敏感个人信息时，先提出候选并取得确认。项目地图的已验证事实可直接更新。历史会话仅在用户授权后作为分批、限量的补充证据，不得全量扫描。
<!-- proma:knowledge-maintenance:end -->
