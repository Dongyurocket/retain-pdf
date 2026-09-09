# Changelog

本仓库（[Dongyurocket/retain-pdf](https://github.com/Dongyurocket/retain-pdf)）是 [wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) 的个人 Fork。
本文件记录 Fork 相对上游的用户可见变更与发布历史；上游自身的演进见上游仓库。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [v4.3.4] - 2026-09-09

### 新增与优化

- **阅读器视口窗口虚拟化（长文档性能暴增）**：引入基于 IntersectionObserver 的视口窗口化机制（保持可视区 ±5 页）。非可视区页面以带精确高度（`cachedAspect`）的占位 div 替代，主动卸载 `Page` 的 Canvas 与渲染上下文释放显存。彻底解决 100 页以上大型 PDF 阅读、缩放与快速滚动时的显存爆满与浏览器卡死。
- **桌面端进程治理与退出清理**：
  - 桌面退出（`before-quit`）引入同步整树清理 `killProcessTreeSync`，彻底杜绝后台 Python workers/AI 进程遗留为孤儿进程继续霸占端口；
  - Rust API 接管控制台中断信号走 Axum 优雅停机流程；
  - 端口检测由 PowerShell 升级为原生 C 二进制（`netstat` + `tasklist`），识别速度提升数十倍，覆盖 41000/42000/41002 全端口，并增加中文环境容错与 `/health` 接口认尸回退。
- **任务状态即时联动（主页卡片刷新不丢转圈）**：任务创建、阶段重试（Stage Retry）与彻底重跑（Rerun）时立即反查并写入文档的 `documents.active_job_id`，解决提交任务后刷新页面主页卡片丢失进行中状态的顽疾。
- **流水线韧性与排版容错**：
  - **402 欠费快速失败**：上游异常严格划分为 Transient（指数退避重试）与 Non-retryable；模型账户欠费（402）时立即快速失败并提示充值，与 Fork 现有的非官方中转接口免余额校验无缝协同；
  - **跨栏跨页续接排除图注**：正则特征检测 Figure/Table/Scheme/方案等标题特征，排除出正文续接池，严格限定跨页续接为尾接头（tail-to-head），杜绝图注被误当正文合并的排版崩坏；
  - **续接复核安全降级**：跨页审校大模型返回非标准 JSON 抛出异常时，安全降级为规则判定，避免辅助复核杀整单；
  - **组完成判定修复**：已独立翻译的单块在复核合并为组后增加成员级判断，防止打回重新 pending；
  - **未翻译块数警告**：成功任务若有段落因限流或超时保留原文，在状态详情与后台日志中如实标注警告，消除用户对渲染引擎排版丢字的误解。
- **前端门禁 100% 全绿**：修复测试文件中的 Windows 路径反斜杠切分、CSS 选择器归位、AI 模块走 external 门面网关，并固化字面色值基线，前端自动化测试达到 743/743 全量通过。

### 安装包

- Windows：`RetainPDF-Windows-4.3.4-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.3.4.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.3.4.deb`

[v4.3.4]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.3.4

## [v4.3.3] - 2026-09-09

### 修复

- 「彻底重跑」对 Paddle OCR 不生效：Paddle 服务端按上传文件的内容指纹复用解析结果（同一文件重复提交会在几秒内直接返回旧结果），且其异步接口没有缓存开关，客户端的 no_cache 标记此前仅对 MinerU 通路生效。现在彻底重跑时 Paddle 通路会提交追加了惰性尾注释的上传副本以改变内容指纹，迫使服务端真实重新解析（实测同一文件从 7 秒缓存命中变为 182 秒全新解析）；本地源文件与既有缓存内容不受影响。

### 安装包

- Windows：`RetainPDF-Windows-4.3.3-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.3.3.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.3.3.deb`

[v4.3.3]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.3.3

## [v4.3.2] - 2026-09-09

### 修复

- 目录（Contents）译文中页码与标题文字重叠（双页码）：源文本剥离引擎按名义字宽模拟文本推进，目录行长点号 leader 使模拟光标越过剥离区域右缘，行尾页码被误判保留并回绘到行首，叠在译文标题上。剥离引擎新增同行连续移除规则，估算超前时同一基线的后续文本一并正确剥离，目录页码不再残留。

### 安装包

- Windows：`RetainPDF-Windows-4.3.2-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.3.2.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.3.2.deb`

[v4.3.2]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.3.2

## [v4.3.1] - 2026-09-09

### 修复

- 升级安装后打开报「端口 41000 已被占用」：旧版 rust_api 进程残留时，桌面端现在先确认无进行中任务，再自动清理残留进程并启动全新实例，无需重启电脑；NSIS 安装器同时会在安装前主动结束残留的 rust_api.exe，从源头避免该问题。

### 安装包

- Windows：`RetainPDF-Windows-4.3.1-Setup.exe`（NSIS 安装包）
- macOS：`RetainPDF-Mac-4.3.1.dmg`（Apple Silicon）
- Linux：`RetainPDF-Linux-4.3.1.deb`

[v4.3.1]: https://github.com/Dongyurocket/retain-pdf/releases/tag/v4.3.1

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
