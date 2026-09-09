# RetainPDF：PDF 保留排版翻译工具

> 本仓库是 [wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) 的个人 Fork：发布包与桌面端更新检测由本仓库维护，详细更新记录见 [CHANGELOG.md](CHANGELOG.md)。

<p align="center">
  <img src="resources/brand/RetainPDF-github.svg" alt="RetainPDF" width="320" />
</p>

<p align="center">
  <a href="https://github.com/Dongyurocket/retain-pdf/releases/latest"><img src="https://img.shields.io/github/v/release/Dongyurocket/retain-pdf?color=blue&label=Latest%20Release" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" /></a>
</p>

开源社区做保留排版的项目不少，但大多围绕可复制、可编辑的 PDF 以及行内公式不复杂的场景。

RetainPDF 从设计之初就致力于解决各类 PDF 的保留排版翻译问题，尤其是图片型/扫描版 PDF，以及复杂行内公式的提取与精确排版回填。

在保留排版翻译场景中，RetainPDF 针对翻译后 PDF 的体积控制、排版保真度、运行速度和字号自适应等关键体验进行了深度工程优化。同时，项目采用前后端分离架构，打通了 OCR、翻译、排版渲染与跨平台交付全链路，模块间保持解耦，既方便开箱即用，也便于二次开发与组件替换。

### 方案对比

| 特性 | PDFMathTranslate | PolyglotPDF | Doc2X | RetainPDF |
| --- | --- | --- | --- | --- |
| 扫描型 / 图片型 PDF | ❌ | ❌ | ✅ | ✅（支持 PaddleOCR / MinerU） |
| 复杂行内公式保护与渲染 | ❌ | ❌ | ✅ | ✅（Typst 引擎深度渲染） |
| 翻译模型灵活性 | ❌ 固定 | ❌ 固定 | ❌ 闭源 | ✅ 支持任意 OpenAI 兼容端点 / 自定义参数 |
| 代码块防误翻 | ❌ | ❌ | ❌ | ✅ |
| 专业术语表（Glossary） | ❌ | ❌ | 弱 | ✅（支持 CSV / TXT 拖拽批量导入） |
| 表格控制 | 弱 | 弱 | 中 | ✅（可配置开关与提取） |
| 排版保真度 | 一般 | 一般 | 强 | 强 |
| PDF 压缩与体积优化 | 一般 | 一般 | 弱 | ✅（持续工程优化） |
| 开放性与自动化 API | ✅ | ✅ | ❌ 不开放 | ✅（全开源 + API / MCP 支持） |

---

## ✨ Fork 增强特性

相比上游版本，本 Fork 针对桌面端实用性、灵活性与稳定性做了大量功能扩充与体验修复：

- **🤖 自定义翻译模型与全兼容端点（设置 → API 设置）**
  - 不仅支持官方 DeepSeek，还全面支持任意 **OpenAI 兼容端点**（如各类大模型 API、聚合中转网关、本地部署的 Ollama / vLLM 等）。
  - 支持基础地址（Base URL，自动补全 `/chat/completions`）与完整直连端点（Full URL）。
  - 提供细粒度的高级推理参数微调：采样温度（Temperature）、核采样（Top P）、请求超时时间、失败重试次数、思考/推理强度（Thinking/Reasoning Auto/Disabled/Low/Medium/High）、并发线程数。
  - 支持多行**自定义系统级翻译规则**，可将特定领域的行文规范、翻译限制与风格约定直接注入 Prompt，所有参数支持一键恢复默认。
  - 自定义端点不支持余额查询时提示「余额需自行确认」并放行，不再阻塞任务提交；官方 DeepSeek 接口行为不变。

- **🔍 双 OCR 引擎自由切换（PaddleOCR / MinerU）**
  - 支持 **PaddleOCR** 与 **MinerU** 双引擎，双引擎 Token 独立保存与校验，互不冲突。
  - MinerU 引擎开放模型版本选择、文档语言设置，以及公式和表格识别开关，显著提升复杂扫描版学术论文与技术文献的解析质量。
  - 桌面端与 Web 端共享该配置体系。

- **🔄 彻底重跑与缓存治理**
  - 状态卡重试菜单新增「彻底重跑」：从 OCR 阶段重新执行，并完全绕过 OCR 与翻译缓存（bypass 期间缓存不读、不写，不污染既有缓存内容），用于排查缓存或上游 OCR 异常导致的坏结果。
  - 针对 PaddleOCR 服务端按上传内容指纹复用解析结果的行为，彻底重跑时自动提交追加惰性尾注释的上传副本，迫使服务端真实重新解析；本地源文件与既有缓存不受影响。

- **📚 术语表（Glossary）批量导入与管理（设置 → 词表）**
  - 导入面板支持直接选择或拖拽本地 `.csv` 与 `.txt` 文件导入。
  - 支持制表符分隔（Tab-separated，可直接从 Excel 复制粘贴），自动剥离 UTF-8 BOM。
  - 内置 CSV 与 TXT 标准样例模板，支持一键下载填充。

- **🎨 排版保真深度修复**
  - 修复含超链接页面（InDesign 等导出的 PDF）翻译后整页变蓝/变红：源文字剥离引擎跟踪 Tr 4–7 文字裁剪作用域，同步丢弃失去裁剪的高亮路径绘制。
  - 修复目录译文错位、双编号/双页码：译文按源行号（`line_index`）对齐，行数不一致时回退保留原标题；剥离引擎新增同行连续移除规则，目录行尾页码不再残留叠印。
  - 输出 PDF 真正删除原文链接注释，避免译文页链接跳转到原文错误位置。

- **📖 图书馆与文档管理体验优化**
  - **真实分页机制**：每页固定 24 项，支持直接输入页码跳转、上一页/下一页无缝翻页与空页保护。
  - **删除状态防竞态**：优化 Windows 文件句柄占用与异步轮询竞态逻辑，避免已删除条目因刷新重新出现。
  - **产物实时打包同步**：任务成功后短轮询产物就绪状态，Markdown ZIP 打包就绪后立即点亮下载，无需重启客户端。
  - 首页与合集页新增手动刷新按钮；书籍详情翻译完成后直接展示结果操作（打开对照阅读等）。

- **⚡ 阅读器视口虚拟化与长文档性能提升**
  - 阅读器引入基于 IntersectionObserver 的视口窗口化机制（保持当前可视区 ±5 页），离开视口的页面卸载 Canvas 上下文并保留精确高度占位，极大降低 GPU 与内存显存占用，彻底解决 100 页以上大型 PDF 缩放与快速滚动时的卡死崩溃。
  - PDF Worker 初始化时序解耦，解决特定打包顺序下的偶发空白页。

- **🚀 上游流水线韧性重试与排版容错**
  - **402 欠费快速失败**：上游异常严格划分为 Transient（指数退避重试）与 Non-retryable；模型账户欠费（402）时立即快速失败并提示充值，不再无脑重试浪费时间。
  - **跨栏跨页续接排除图注**：正则特征检测 Figure/Table/Scheme/方案等标题特征，排除出正文续接池，严格限定跨页续接为尾接头（tail-to-head），彻底杜绝学术论文中图注被误当正文合并的排版崩坏。
  - **续接复核安全降级**：跨页审校大模型返回非标准 JSON 抛出异常时，安全降级为规则判定，避免辅助复核杀整单。
  - **组完成判定修复**：已独立翻译的单块在复核合并为组后增加成员级判断，防止打回重新 pending。
  - **未翻译块数警告**：成功任务若有段落因限流或超时保留原文，在状态详情与后台日志中如实标注警告，消除用户对渲染引擎排版丢字的误解。

- **🛡️ 桌面端与跨平台优化**
  - 修复 Windows 上传路径反斜杠安全检查，统一跨平台行为。
  - **退出整树同步清理**：退出时同步清理整棵子进程树，Rust 端接入控制台信号走 Axum 优雅关机，彻底断绝 Python workers 与 AI 孤儿进程残留。
  - **端口占用自愈**：启动时使用原生 `netstat` + `tasklist` 毫秒级识别占用进程，覆盖 41000/42000/41002 全端口，支持中文环境容错与 `/health` 接口认尸回退；NSIS 安装器在安装前主动结束残留进程，升级安装后不再报端口占用。
  - 客户端“检查更新”直通本 Fork Releases，方便及时获取最新发布包。

---

## 效果图

### SCI 论文

<p align="center">
  <img src="resources/brand/readme-gallery/image%201.png" alt="SCI 示例 1" width="860" />
</p>

<p align="center">
  <img src="resources/brand/readme-gallery/image%202.png" alt="SCI 示例 2" width="860" />
</p>

### 图片型 / 扫描版 PDF

<p align="center">
  <img src="resources/brand/readme-gallery/image%203.png" alt="扫描版示例 1" width="860" />
</p>

<p align="center">
  <img src="resources/brand/readme-gallery/image%207.png" alt="扫描版示例 2" width="860" />
</p>

### 图书类

<p align="center">
  <img src="resources/brand/readme-gallery/image%204.png" alt="图书示例 1" width="860" />
</p>

<p align="center">
  <img src="resources/brand/readme-gallery/image%205.png" alt="图书示例 2" width="860" />
</p>

<p align="center">
  <img src="resources/brand/readme-gallery/image%206.png" alt="图书示例 3" width="860" />
</p>

---

## 快速开始

### 桌面端下载（推荐日常使用）

前往 [GitHub Releases](https://github.com/Dongyurocket/retain-pdf/releases/latest) 下载对应平台的最新安装包（当前版本 **v4.3.4**）：

- **Windows**：下载 `RetainPDF-Windows-4.3.4-Setup.exe`（NSIS 安装包）
- **macOS**：下载 `RetainPDF-Mac-4.3.4.dmg`（适配 Apple Silicon 架构）
- **Linux**：下载 `RetainPDF-Linux-4.3.4.deb`（适配 Debian / Ubuntu 系列）

#### Windows 桌面端界面

<p align="center">
  <img src="resources/brand/RetainPDF-desktop.png" alt="RetainPDF Windows 桌面端" width="860" />
</p>

#### macOS 提示

由于当前未加入 Apple 开发者计划，macOS 版本首次打开时可能出现应用“已损坏”或无法打开的安全提示。将应用拖入 `/Applications` 后，在终端中执行以下命令即可正常运行：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/RetainPDF.app
```

---

### 使用指引

1. **配置 OCR 与翻译模型**：
   - 打开应用，点击右上角进入 **设置 → API 设置**。
   - **OCR 设置**：选择使用 PaddleOCR 或 MinerU，输入对应的 Token 并测试连通性。
   - **翻译模型设置**：输入模型名称（如 `deepseek-chat` 或任意兼容模型名）、API Key 与接口地址（Base URL 或 Full URL）。可根据需要在高级参数区调节温度、并发、思考强度或自定义翻译规则。
2. **导入术语表（可选）**：
   - 进入 **设置 → 词表**，可一键下载 CSV / TXT 模板，填充专业术语后拖入面板完成批量导入。
3. **上传并翻译**：
   - 返回首页，上传待处理的 PDF 文件，按需选择工作流模式（SCI 论文 / 图书），点击开始翻译。
   - 翻译完成后，可在图书馆中查看、翻阅或直接下载排版保留的 PDF 与 Markdown ZIP 产物包。

---

### Docker 部署（适合局域网 / 团队服务）

当前仓库提供了完整的 Docker 交付配置：

- [docker/delivery/README.md](docker/delivery/README.md)
- [docker/delivery/docker-compose.yml](docker/delivery/docker-compose.yml)

基本部署步骤：

```bash
git clone https://github.com/Dongyurocket/retain-pdf.git
cd retain-pdf/docker/delivery
docker compose up -d
```

启动后默认访问地址：

```text
http://127.0.0.1:40001
```

默认端口说明：

- `40001`：Web 前端页面
- `41000`：Rust API 服务
- `42000`：multipart 异步文件提交接口

#### Docker 更新

更新至最新镜像版本：

```bash
cd retain-pdf/docker/delivery
docker compose pull
docker compose up -d
```

切换指定镜像版本：

```bash
cd retain-pdf/docker/delivery
APP_IMAGE=wxyhgk/retainpdf-app:<version> \
WEB_IMAGE=wxyhgk/retainpdf-web:<version> \
docker compose up -d
```

---

## 交流群

如果在使用、部署或二次开发 RetainPDF 时遇到问题，欢迎加入交流群：

- QQ 群号：`1101779791`

<p align="center">
  <img src="resources/brand/QQ_Group.JPG" alt="RetainPDF QQ 交流群二维码" width="280" />
</p>

---

## 开发者

### 文档入口

- [贡献指南](CONTRIBUTING.md)
- [文档目录](doc/README.md)
- [主线文档](doc/core/README.md)
- [参考资料](doc/reference/README.md)
- [运维与过程记录](doc/ops/README.md)
- [Pipeline 阶段契约](backend/scripts/runtime/pipeline/README.md)

### 代码与模块说明

- [后端脚本说明](backend/scripts/README.md)
- `frontend/`：当前生产前端，也是桌面端 bundle 的输入目录；index/reader/detail 三页均已迁移为 React SPA（`src/pages/`，esbuild 构建打包）。
- `frontend-react/`：另一条 React 前端迁移区（独立技术栈：Vite + TypeScript）。
- `desktop/`：Electron 桌面端打包与运行壳。
- `backend/`：Rust API、Python 流水线核心算法与相关服务。
- `docker/`：Dockerfile、交付与部署 compose 配置。
- `mcp/`：stdio MCP 桥接实现，供 AI Agent 自动化调度本地 RetainPDF。

### 核心开发状态与方向

RetainPDF 目前具备完整的产品链路：

- **Rust API**：负责任务状态机、图书馆文档管理、事件流广播、产物引用与进程编排。
- **Python Pipeline**：负责版面 OCR 归一化、智能翻译、公式保护、排版对齐渲染与 PDF 生成。
- **Frontend & Desktop**：三页 React SPA 与 Electron 壳，支持跨平台本地运行与局域网 Web 访问。

持续关注与改进的方向包括：

- 复杂扫描版面与公式的排版保留精度
- 长段落与紧密公式混合排版下的文字避让与字体自适应
- 翻译一致性与术语注入效果
- 跨平台工程化构建与轻量化部署

欢迎对 PDF 解析、排版渲染、大模型翻译应用感兴趣的开发者共同探讨与贡献！

---

## License

本项目遵循 [MIT License](LICENSE)。
