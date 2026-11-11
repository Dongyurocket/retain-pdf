# RetainPDF 项目地图（Proma 维护）

PDF 保留排版翻译全栈项目：扫描/图片型 PDF、行内公式渲染是核心场景。前后端分离：Rust API + Python OCR/翻译/渲染流水线 + 前端 SPA + Electron 桌面端 + Docker 交付。

<!-- proma:project-map:start -->
## 项目入口与执行环境

- 项目根 = 本文件所在目录（retain-pdf 仓库）。`origin` = 个人 Fork `Dongyurocket/retain-pdf`，`upstream` = 原作者 `wxyhgk/retain-pdf`；Fork 独立迭代，只定向移植上游改动，不整体 merge。
- 平台 Windows；bash 为 Git Bash 路径（`/c/Users/...`），写文件用 Windows 绝对路径。会话工作台 `../<会话 UUID>/`，项目级跨会话资料放 `.context/`，长期记忆在 `../memory/`（`MEMORY.md` 为索引）。
- `cargo build` / `cargo test` 必须用 PowerShell 或 VS Developer PowerShell，Git Bash 的 `link.exe` 会抢先报 `extra operand`；本机 Python / typst / gs 路径见 `../memory/local-env.md`。

## 架构与目录

- `backend/rust_api/`：Rust API 服务（Cargo），负责任务状态、stage spec、事件流、artifact 引用、图书馆与进程编排。契约文档见该目录根：`API_SPEC.md`、`RUST_API_ARCHITECTURE.md`、`STAGE_EXECUTION_CONTRACT.md`、`OCR_PROVIDER_CONTRACT.md`。
- `backend/scripts/`：Python 流水线，分层 `runtime/`（pipeline 编排）、`services/`（OCR/翻译/渲染实现）、`foundation/`（配置/共享工具）、`entrypoints/`（人工入口）、`devtools/`（测试探针、诊断、架构检查）。主链路 `PDF -> OCR provider -> document.v1.json -> translation -> rendering -> PDF`；stage 为 `normalize.stage.v1` -> `translate.stage.v1` -> `render.stage.v1`，整书由 `book.stage.v1` 编排。
- `backend/packages/`：可编辑安装包 `retainpdf-core`、`retainpdf-devtools`（测试正向 `backend/python-tests/` 迁移）；`backend/fonts/`：发布字体资源（非缓存）。
- `frontend/`：生产前端，三页 React SPA（index/reader/detail，esbuild + Tailwind 4）；`frontend-react/` 是另一条技术栈的迁移区，不替代 `frontend/`。
- `desktop/`：Electron 打包与运行壳；`docker/`：Dockerfile、本地构建脚本（`docker/build-images.sh`）与交付 compose（`docker/delivery/`），不再发布官方镜像；`mcp/`：stdio MCP 桥。
- `doc/`：文档库（入口 `doc/README.md`）；`experiments/`：独立实验与 POC；`data/`：本地运行输出与样本（不入库）。

## 常用命令

- Rust API 本地启动（仓库根）：`cd backend/rust_api && RUST_API_DATA_ROOT=<abs data> RUST_API_SCRIPTS_DIR=<abs scripts> cargo run`（DATA_ROOT/SCRIPTS_DIR 建议绝对路径）。
- 前端：`npm run build`（css+js+version；改样式类名后必须跑并提交生成的 `styles.css`）、`npm run typecheck`、`npm test`、`npm run visual:check`；静态服务 `python3 -m http.server 40001`。
- Python 测试：先 `pip install -e backend/packages/retainpdf-core` 与 `-e backend/packages/retainpdf-devtools --no-build-isolation`，再 `python backend/python-tests/run_python_tests.py [可选测试路径]`。
- 桌面端主进程测试：`cd desktop && npm test`（未接 CI）。
- 专题细节按需读 `../memory/`：验证基线与 CI 陷阱 `verification-and-ci.md`、端口动态化与 Windows 端口保留坑 `desktop-runtime.md`、发版与更新检测 `release-flow.md`、MCP 与工作区约定 `workspace-mcp.md`、本机工具链 `local-env.md`。

## 边界与红线

- Python `runtime/pipeline/` 只做阶段编排，不消费 OCR provider 原始结构；翻译走 `services.translation.workflow` facade；渲染源预处理走 `services.rendering.source.*`。
- OCR 原始产物先归一化为 `ocr/normalized/document.v1.json`；翻译/渲染只消费 normalized document 与 translation artifacts，是否进翻译以 `policy.translate` 为准。
- 不提交：`backend/scripts/.env/*.env`、`backend/rust_api/auth.local.json`、`secrets/`、`backend/rust_api/target/`、`backend/python/`、`backend/typst-win32/bin/`。
- `backend/` 含运行时产物（target、嵌入式 python、typst-win32），不要当纯源码目录整体移动；整理方向见 `backend/README.md`。

## 关键文档索引

- 总入口：`README.md`、`CHANGELOG.md`（Fork 相对上游的变更与发布记录）、`CONTRIBUTING.md`、`doc/README.md`
- 后端：`backend/README.md`（目录边界）、`backend/scripts/README.md`（流水线契约）、`backend/rust_api/`（API 契约族）
- 测试：`backend/python-tests/README.md`；MCP：`mcp/README.md`
<!-- proma:project-map:end -->

<!-- proma:knowledge-maintenance:start -->
## 协作知识演进（Proma 维护）

- 保持本文件中的项目地图与已验证项目事实同步；命令、架构、边界和入口变化时做最小更新，模块 SOP、排障经过与时点快照下沉到 `../memory/` 主题文件。
- Proma 工作区的 `../memory/` 是可扩展的长期协作知识库：`MEMORY.md` 只做主题索引和路由，按证据创建协作偏好、纠错与经验、决策理由等主题文件；不要把临时过程或长篇证据写入其中。
- 用户画像按具体领域渐进修订，不以“新手/专家”等全局标签定性。只有稳定、会改变未来协作判断的信息才值得维护。
- 基于明确、稳定证据的 Memory 最小增量可直接写入并在完成后说明；仅在删除或大段覆盖、与既有记录冲突、存在不确定推断，或可能涉及敏感个人信息时，先提出候选并取得确认。项目地图的已验证事实可直接更新。历史会话仅在用户授权后作为分批、限量的补充证据，不得全量扫描。
<!-- proma:knowledge-maintenance:end -->

<!-- proma:memory:start -->
## 记忆维护

- **个人层（常驻）**：[user_profile.md](<C:\Users\yusen\.proma\memory\user_profile.md>)，跨项目共享，仅记录换个项目也成立的个人背景与稳定偏好。
- **项目护栏层（常驻）**：本文件（AGENTS.md，预算 ≤4000 非空白字符），仅保留不看就会在本项目犯错的子项目结构、常用命令与全局红线；具体模块细节、排障经过和某日状态快照一律下沉到项目 memory/。
- **专题手册层（按需）**：[MEMORY.md](<C:\Users\yusen\.proma\agent-workspaces\retain-pdf\memory\MEMORY.md>) 仅维护一行一条的场景路由索引（预算 ≤3500 字符，不写长篇结论摘要），详细主题按索引按需读取；过期或已合并的存量文件（含历史 project-preferences.md）通过可恢复归档移出有效入口。读取不等于核验，不编造用户事实。
<!-- proma:memory:end -->
