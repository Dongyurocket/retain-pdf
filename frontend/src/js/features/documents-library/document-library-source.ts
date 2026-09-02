// 文档中心网格的分页数据源(计划 F2)。返回形状与
// recent-jobs/pagination.js#collectRecentJobsPage 对齐
// ({ collected, hasMore, latestInvocationSummary, nextOffset, total }),这样
// recent-jobs 的 loader.js/commit.js/store 引擎可以一行不改地消费它。
//
// 每篇文档产出一张卡:先拉一页 /documents,收集该页 active_job_id,批量向
// library/books?job_ids= 取这些 job 的实时活态,再按 job_id 合并
// (shapeDocumentCardItem)。馆藏文档(无 active_job_id)拿合成 job_id 穿过引擎。
//
// 搜索:/documents 目前没有服务端文本搜索(仅 reading_status/tag/collection 过滤),
// 这里 query 走**客户端标题/文件名过滤**;有 query 时一次多拉一批再过滤、并关掉
// 继续分页。文档级服务端全文/标题搜索是后端待补项(见 memory
// f2-document-centric-grid-design)。

import { shapeDocumentsWithBooks } from "./shape-documents-with-books.js";
import { isTombstoned } from "../recent-jobs/tombstones.js";

const SEARCH_FETCH_LIMIT = 200;

function normalizedJobId(value) {
  return `${value || ""}`.trim();
}

export async function collectDocumentLibraryPage({
  fetchDocumentList,
  fetchLibraryBookList,
  apiPrefix,
  startOffset = 0,
  pageSize,
  existingJobIds = new Set(),
  query = "",
}: any) {
  const trimmedQuery = `${query || ""}`.trim().toLowerCase();
  const searching = trimmedQuery.length > 0;
  const seen = existingJobIds instanceof Set
    ? new Set(existingJobIds)
    : new Set((Array.isArray(existingJobIds) ? existingJobIds : []).map(normalizedJobId).filter(Boolean));

  const limit = searching ? Math.max(pageSize, SEARCH_FETCH_LIMIT) : pageSize;
  const offset = searching ? 0 : startOffset;

  const payload = await fetchDocumentList(apiPrefix, { limit, offset });
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];
  const documentTotal = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : documents.length;

  // 文档 → 卡片的映射走统一编排(shapeDocumentsWithBooks);去重/搜索过滤这些
  // 分页数据源自己的关切留在下面。
  const shaped = await shapeDocumentsWithBooks(documents, { fetchLibraryBookList, apiPrefix });

  const matched = [];
  for (const item of shaped) {
    const key = normalizedJobId(item.job_id);
    if (!key || seen.has(key) || isTombstoned(item)) {
      continue;
    }
    if (searching) {
      const haystack = `${item.title || ""} ${item.display_name || ""} ${item.source_file_name || ""}`.toLowerCase();
      if (!haystack.includes(trimmedQuery)) {
        continue;
      }
    }
    seen.add(key);
    matched.push(item);
  }

  // 搜索当前仍走客户端筛选:先取上限内候选,再按 startOffset 切成真正的 24 条页。
  // 普通浏览直接使用 /documents 返回的 total(服务端分页)。
  const total = searching ? matched.length : documentTotal;
  const collected = searching
    ? matched.slice(startOffset, startOffset + pageSize)
    : matched;
  const hasMore = searching
    ? startOffset + collected.length < total
    : documents.length > 0 && offset + documents.length < total;
  const nextOffset = searching
    ? startOffset + pageSize
    : startOffset + documents.length;

  return {
    collected,
    hasMore,
    latestInvocationSummary: null,
    nextOffset,
    total,
  };
}
