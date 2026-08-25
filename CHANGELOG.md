# Changelog

本仓库（[Dongyurocket/retain-pdf](https://github.com/Dongyurocket/retain-pdf)）是 [wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) 的个人 Fork。
本文件记录 Fork 相对上游的用户可见变更与发布历史；上游自身的演进见上游仓库。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
