# Changelog

本仓库（[Dongyurocket/retain-pdf](https://github.com/Dongyurocket/retain-pdf)）是 [wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) 的个人 Fork。
本文件记录 Fork 相对上游的用户可见变更与发布历史；上游自身的演进见上游仓库。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [v4.3.0] - 2026-09-09

### 新增

- **彻底重跑**：状态卡重试菜单新增「彻底重跑」——从 OCR 阶段重新执行，并完全绕过 OCR 与翻译缓存（bypass 期间缓存不读、不写，不污染既有缓存内容），用于排查缓存或上游 OCR 异常导致的坏结果。
- 图书馆首页与合集页新增手动刷新按钮；书籍详情翻译页完成后显示结果操作（打开对照阅读等）。

### 修复

- 自定义 OpenAI 兼容翻译接口不支持余额查询时，不再因「余额未检测」阻塞提交：检测后提示「余额需自行确认」并放行，官方 DeepSeek 接口行为不变。
- 书籍详情封面与操作可用性在书架投影延迟时不更新：详情现以文档详情接口的完成态资源作为回退来源。

### 安装包

- Windows：`RetainPDF-Windows-4.3.0-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.3.0.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.3.0.deb`

[v4.3.0]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.3.0

## [v4.2.2] - 2026-09-09

### 修复

- **含超链接页面翻译后整页变蓝/变红**：部分 PDF（InDesign 等导出）用 Tr 7 文字裁剪路径把链接高亮矩形裁剪到文字字形；源文字剥离删除链接文字后，高亮矩形失去裁剪并无界铺开，导致整页铺满高亮色。现在剥离引擎跟踪 Tr 4–7 文字删除位置，并同步丢弃其 q..Q 作用域内失去裁剪的路径绘制。
- **目录译文错位、双编号/双页码**：目录条目译文对齐误用条目序号而非源行号，任一条目解析缺失（如表头残行）后全部错位。现按源行号（`line_index`）对齐译文行；译文行数与源行数不一致时回退保留原标题，不再强行错位配对。
- 输出 PDF 不再残留原文链接注释（`strip_page_links` 原为空实现，现真正删除），避免译文页链接跳转到原文错误位置。

### 安装包

- Windows：`RetainPDF-Windows-4.2.2-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.2.2.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.2.2.deb`

[v4.2.2]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.2.2

## [v4.2.1] - 2026-09-06

### 修复

- **Windows 上传文件名安全检查漏洞**：含反斜杠路径穿越的上传文件名（如 `..\..\evil.pdf`）在 Windows 上被静默截断为纯文件名而未被拒绝。现统一在路径解析前显式拒绝反斜杠，三平台行为一致。该问题仅影响 Windows 桌面端，macOS/Linux 与 Docker 部署原本即拒绝。
- Windows 本机开发测试两例平台差异失败清零（`cargo test` 310/310 通过）。

### 安装包

- Windows：`RetainPDF-Windows-4.2.1-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.2.1.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.2.1.deb`

[v4.2.1]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.2.1

## [v4.2.0] - 2026-09-06

### 新增

- **自定义翻译模型与推理参数（设置 → API 设置）**：翻译模型卡片升级为通用配置——可自由填写模型名称、API 密钥、基础 API 地址（Base URL，自动拼接 `/chat/completions`）与可选的完整请求端点（Full URL，填写后优先直连该地址），兼容 DeepSeek 官方及任意 OpenAI 兼容网关/中转。任务选项新增可回默认值的高级参数区：采样温度（0.0/0.2/0.5/0.7/1.0 预设，默认 0.2）、核采样 Top P（默认 1.0）、单次请求超时（默认 120 秒）、失败重试次数（默认 2）、思考/推理强度（auto/disabled/low/medium/high）、翻译模式、公式模式、并发线程数、上下文与术语注入策略，以及多行自定义翻译规则（直接注入系统指令）。全部参数一键恢复默认，保存后本机持久生效。
- **术语表快速导入（设置 → 词表）**：词表导入面板支持直接选择或拖放 `.csv` / `.txt` 文件读取内容；解析器新增制表符分隔（Tab）TXT 文本识别（可直接粘贴自 Excel）、UTF-8 BOM 剥离，并继续兼容带中英文表头或无表头的 CSV。面板内置 CSV 与 TXT 两份标准模板样例，一键下载后填充即可导入。

### 安装包

- Windows：`RetainPDF-Windows-4.2.0-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.2.0.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.2.0.deb`

[v4.2.0]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.2.0

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

## [v4.1.12] - 2026-08-26

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
