# Changelog

本仓库（[Dongyurocket/retain-pdf](https://github.com/Dongyurocket/retain-pdf)）是 [wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) 的个人 Fork。
本文件记录 Fork 相对上游的用户可见变更与发布历史；上游自身的演进见上游仓库。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [v4.1.13] - 2026-09-02

### 修复

- **图书馆真正分页**：图书馆固定每页 24 条，新增页码选择、上一页/下一页和空页自动回退；后端与文档库数据源返回过滤后的总数，搜索结果也支持分页。
- **删除后条目复活**：删除时即使 Windows 文件句柄暂时占用文件，也会先完成数据库删除；前端过滤异步刷新和轮询竞态，避免已删除条目重新出现。
- **Markdown ZIP 下载状态延迟同步**：任务成功后短时间重试产物清单，压缩包就绪后立即启用下载按钮，无需重启应用。

### 安装包

- Windows：`RetainPDF-Windows-4.1.13-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.1.13.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.1.13.deb`

[v4.1.13]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.1.13

### 新增

- **桌面版 OCR 引擎可选：MinerU / PaddleOCR（默认 PaddleOCR）**：设置 → API 设置 → OCR 卡片新增引擎选择器，两个引擎的 token 独立保存、互不覆盖。PaddleOCR 暴露 API 地址（留空用公共端点）与模型（默认 PaddleOCR-VL-1.6）；MinerU 暴露模型版本（默认 vlm）、文档语言（默认 ch）与公式/表格识别开关（默认开启，适配扫描 PDF + 行内公式场景）。Token 校验按引擎分发到对应端点（`providers/paddle/validate-token` / `providers/mineru/validate-token`），提交任务时按引擎组装 `ocr` 分组参数。网页版共享同一设置界面，同步获得该能力。

### 修复

- **凭据保存与引擎切换的竞态**：保存的异步落盘完成后会用保存时的旧快照二次回写内存态，期间切换 OCR 引擎会被旧值覆盖。二次回写时引擎以最新状态为准。

### 安装包

- Windows：`RetainPDF-Windows-4.1.12-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.1.12.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.1.12.deb`

[v4.1.12]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.1.12

## [v4.1.11] - 2026-08-25

首个 Fork 自主发布版本。代码基线：上游 `main`（`e5c5d28f`，上游 v4.1.9 之后），叠加以下 Fork 变更。

### 修复

- **图书馆分页只显示第一页**：Rust API 的 documents 列表接口补齐 `total` 字段（与列表同一套过滤条件的 `COUNT(*)`）。前端分页的 `hasMore` 依赖该字段，此前响应缺失导致回退为当前页大小，第一页（24 本）之后"更多"按钮与滚动自动加载全部失效。
- **合集/收藏视图无法纵向滚动**：Tailwind v4 的 `@utility` 生成顺序不跟随源码顺序，产物中 `.library-view{overflow:hidden}` 排在合集/收藏视图的 `overflow-y:auto` 之后将其覆盖。通过给两个 utility 追加双类规则（specificity (0,2,0)）与生成顺序脱钩。
- **合集加载失败无重试**：桌面端启动早期后端未就绪（日志可见约 90s 端口等待）属常见瞬时故障，此前拉取失败一次即定格错误态。现自动静默重试一次（1.5s），仍失败才显示错误，且两个错误态均支持手动重试。
- 修正 `versioned_migrations_are_idempotent` 断言（迁移阶梯在 v4.1.9 已加 v3 消息树分支，断言未跟上）。

以上图书馆分页、合集/收藏滚动、合集加载重试三项修复已同步提交上游 PR [#91](https://github.com/wxyhgk/retain-pdf/pull/91)。

### 变更

- **更新检测源切换到 Fork**：桌面端"检查更新"的查询目标由上游 `wxyhgk/retain-pdf` 改为本仓库（`desktop/package.json` 的 `homepage` 在构建期生成前端使用的 `GITHUB_REPO`）。注意：更新检测地址在构建时写入安装包，只有本版本及之后的安装包查询 Fork 的 Releases，更早的安装包仍查询上游。
- 首页顶栏仓库链接指向本 Fork。

### 维护

- `.gitignore` 补充忽略 `secrets/`、本地 docker compose override 与 `.codegraph/`，防止误提交凭据。

### 安装包

- Windows：`RetainPDF-Windows-4.1.11-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.1.11.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.1.11.deb`

[v4.1.11]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.1.11
