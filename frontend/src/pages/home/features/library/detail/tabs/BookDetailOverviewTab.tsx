// Tab「书籍简介」——标题 / 作者 / 标签 / 编辑 + 元信息网格。
// 改简介相关 UI 只动本文件（或 TitleMetaPanel）。
// 元信息（页数/大小/入库/合集）自左栏迁入：右栏不再空旷，左栏纯粹封面+主操作。

import { IconLayers } from "../panels/ui.jsx";
import { TitleMetaPanel } from "../panels/TitleMetaPanel.jsx";

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function MetaCell({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * @param {object} props TitleMetaPanel 业务 props + 元信息（pageCount/bytes/addedAt/memberCollections）
 */
export function BookDetailOverviewTab({
  pageCount,
  bytes,
  addedAt,
  memberCollections = [],
  ...titleMetaProps
}: any) {
  const sizeText = formatBytes(bytes);
  const dateText = formatDate(addedAt);
  return (
    <div
      className="book-detail-tab-overview space-y-5"
      data-book-detail-tab="overview"
    >
      <TitleMetaPanel {...titleMetaProps} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border/60 p-4 sm:grid-cols-4">
        <MetaCell label="页数">{pageCount ? `${pageCount} 页` : "—"}</MetaCell>
        <MetaCell label="大小">{sizeText || "—"}</MetaCell>
        <MetaCell label="入库">{dateText || "—"}</MetaCell>
        <MetaCell label="合集">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <IconLayers className="shrink-0 text-muted-foreground" />
            <span className="truncate">
              {memberCollections.length ? memberCollections.join("、") : "未加入"}
            </span>
          </span>
        </MetaCell>
      </dl>
    </div>
  );
}
