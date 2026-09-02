// 图书馆真分页控件(24 条/页):上一页 / 页码窗口(带省略号)/ 下一页。
// 点击页码经 onPageChange 上报,由 RecentJobsLibrary 走引擎的
// loadRecentJobs({ reset: true, page }) 完成真正分页加载。

import { useMemo } from "react";

function buildPageItems(currentPage, totalPages) {
  const pages = [];
  const push = (kind, value, key) => pages.push({ kind, value, key });
  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) {
      push("page", page, `p${page}`);
    }
    return pages;
  }
  push("page", 1, "p1");
  if (currentPage > 3) push("ellipsis-start", null, "e1");
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let page = start; page <= end; page += 1) {
    push("page", page, `p${page}`);
  }
  if (currentPage < totalPages - 2) push("ellipsis-end", null, "e2");
  push("page", totalPages, `p${totalPages}`);
  return pages;
}

export function LibraryPagination({
  currentPage = 1,
  totalPages = 1,
  busy = false,
  onPageChange,
} = {}) {
  const safeCurrent = Math.max(1, Math.min(totalPages, Number(currentPage) || 1));
  const items = useMemo(
    () => buildPageItems(safeCurrent, totalPages),
    [safeCurrent, totalPages],
  );

  if (totalPages <= 1) {
    return null;
  }

  const disabledPrev = busy || safeCurrent <= 1;
  const disabledNext = busy || safeCurrent >= totalPages;

  return (
    <nav className="library-pagination" aria-label="图书馆分页">
      <button
        type="button"
        className="library-pagination-btn library-pagination-nav"
        disabled={disabledPrev}
        aria-label="上一页"
        onClick={() => onPageChange?.(safeCurrent - 1)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {items.map(({ kind, value, key }) => (
        kind === "page" ? (
          <button
            key={key}
            type="button"
            className={`library-pagination-btn${value === safeCurrent ? " is-current" : ""}`}
            aria-current={value === safeCurrent ? "page" : undefined}
            disabled={busy}
            onClick={() => onPageChange?.(value)}
          >
            {value}
          </button>
        ) : (
          <span key={key} className="library-pagination-ellipsis" aria-hidden="true">…</span>
        )
      ))}
      <button
        type="button"
        className="library-pagination-btn library-pagination-nav"
        disabled={disabledNext}
        aria-label="下一页"
        onClick={() => onPageChange?.(safeCurrent + 1)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </nav>
  );
}
