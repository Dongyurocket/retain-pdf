import test from "node:test";
import assert from "node:assert/strict";
import {
  shapeDocumentCardItem,
  syntheticLibraryJobId,
  isLibraryOnlyItem,
  LIBRARY_ONLY_JOB_PREFIX,
} from "../src/js/features/documents-library/document-card-item.js";
import { collectDocumentLibraryPage } from "../src/js/features/documents-library/document-library-source.js";

// ===== shapeDocumentCardItem:三种文档态映射 =====

test("已翻译文档:合并 library/books 活态,保留真实 job_id 与文档身份", () => {
  const document = {
    document_id: "docA",
    title: "共轭选择性",
    source_filename: "a.pdf",
    page_count: 10,
    active_job_id: "20260601-a",
    reading_status: "reading",
    tags: ["化学"],
    source_pdf_url: "/api/v1/documents/docA/source.pdf",
    cover_url: "/api/v1/documents/docA/cover",
    updated_at: "2026-06-01T12:00:00Z",
  };
  const book = {
    id: "20260601-a",
    job_id: "20260601-a",
    title: "a.pdf",
    status: "succeeded",
    stage: "finished",
    progress: { current: 10, total: 10, percent: 100, unit: "none" },
    cover_url: "/api/v1/library/books/20260601-a/cover",
    page_count: 10,
    updated_at: "2026-06-01T12:00:00Z",
  };
  const item = shapeDocumentCardItem(document, book);
  assert.equal(item.library_only, false);
  assert.equal(item.job_id, "20260601-a", "保留真实 job_id → 轮询/对照阅读可用");
  assert.equal(item.document_id, "docA");
  assert.equal(item.status, "succeeded");
  assert.equal(item.reading_status, "reading");
  assert.deepEqual(item.tags, ["化学"]);
  assert.equal(item.source_pdf_url, "/api/v1/documents/docA/source.pdf");
  // book 带了 cover → 用 book 的(与现网格视觉一致)
  assert.equal(item.cover_url, "/api/v1/library/books/20260601-a/cover");
});

test("已翻译但 book 缺 cover:封面回退到文档级 cover_url", () => {
  const item = shapeDocumentCardItem(
    { document_id: "docA", active_job_id: "j1", cover_url: "/api/v1/documents/docA/cover" },
    { job_id: "j1", status: "running", progress: {} },
  );
  assert.equal(item.cover_url, "/api/v1/documents/docA/cover");
});

test("馆藏文档(无 active_job_id):合成 job_id + library_only 标记", () => {
  const item = shapeDocumentCardItem({
    document_id: "docRef",
    title: "工具书",
    source_filename: "ref.pdf",
    page_count: 42,
    active_job_id: null,
    reading_status: "unread",
    tags: ["工具书"],
    source_pdf_url: "/api/v1/documents/docRef/source.pdf",
    cover_url: "/api/v1/documents/docRef/cover",
    updated_at: "2026-06-10T09:00:00Z",
  }, null);
  assert.equal(item.library_only, true);
  assert.equal(item.job_id, `${LIBRARY_ONLY_JOB_PREFIX}docRef`);
  assert.equal(item.job_id, syntheticLibraryJobId("docRef"));
  assert.ok(isLibraryOnlyItem(item));
  assert.equal(item.active_job_id, "");
  assert.equal(item.status, "");
  assert.equal(item.title, "工具书");
  assert.equal(item.cover_url, "/api/v1/documents/docRef/cover");
  assert.equal(item.source_pdf_url, "/api/v1/documents/docRef/source.pdf");
});

test("空字符串 active_job_id 也当馆藏处理", () => {
  const item = shapeDocumentCardItem({ document_id: "d", active_job_id: "" }, null);
  assert.equal(item.library_only, true);
  assert.equal(item.job_id, syntheticLibraryJobId("d"));
});

test("有 active_job_id 但 book 缺失:保留真实 job_id,非馆藏,状态空", () => {
  const item = shapeDocumentCardItem(
    { document_id: "d", active_job_id: "j-missing", title: "x", page_count: 3 },
    null,
  );
  assert.equal(item.library_only, false);
  assert.equal(item.job_id, "j-missing");
  assert.equal(item.status, "");
});

// ===== collectDocumentLibraryPage:分页 + 合并 + 去重 + 搜索 =====

function makeFetchers({ documents, total, books }) {
  const calls = { documentQuery: null, bookJobIds: null };
  const fetchDocumentList = async (_prefix, params) => {
    calls.documentQuery = params;
    const offset = params.offset || 0;
    const limit = params.limit || documents.length;
    return { documents: documents.slice(offset, offset + limit), total, limit, offset };
  };
  const fetchLibraryBookList = async (_prefix, { jobIds = [] } = {}) => {
    calls.bookJobIds = jobIds;
    const wanted = new Set(jobIds);
    return { items: books.filter((b) => wanted.has(b.job_id)) };
  };
  return { fetchDocumentList, fetchLibraryBookList, calls };
}

test("整合一页:已翻译合并 book,馆藏用合成 id,hasMore 由 total 决定", async () => {
  const documents = [
    { document_id: "d1", active_job_id: "j1", title: "已翻译一", page_count: 5 },
    { document_id: "d2", active_job_id: null, title: "馆藏二", page_count: 8 },
    { document_id: "d3", active_job_id: "j3", title: "已翻译三", page_count: 9 },
  ];
  const books = [
    { job_id: "j1", status: "succeeded", progress: { percent: 100 } },
    { job_id: "j3", status: "running", progress: { percent: 40 } },
  ];
  const { fetchDocumentList, fetchLibraryBookList, calls } = makeFetchers({ documents, total: 5, books });

  const page = await collectDocumentLibraryPage({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: "/api/v1",
    startOffset: 0,
    pageSize: 3,
    existingJobIds: new Set(),
    query: "",
  });

  assert.equal(page.collected.length, 3);
  assert.deepEqual(calls.bookJobIds, ["j1", "j3"], "只对有 active_job_id 的文档取 book");
  assert.equal(page.collected[0].status, "succeeded");
  assert.equal(page.collected[1].library_only, true);
  assert.equal(page.collected[1].job_id, syntheticLibraryJobId("d2"));
  assert.equal(page.collected[2].status, "running");
  assert.equal(page.hasMore, true, "3/5 → 还有更多");
  assert.equal(page.total, 5, "服务端 total 透传给页码控件");
  assert.equal(page.nextOffset, 3);
});

test("跨页去重:existingJobIds 命中的(含合成 id)不重复收集", async () => {
  const documents = [
    { document_id: "d1", active_job_id: "j1", title: "a" },
    { document_id: "d2", active_job_id: null, title: "b" },
  ];
  const { fetchDocumentList, fetchLibraryBookList } = makeFetchers({ documents, total: 2, books: [{ job_id: "j1", status: "succeeded" }] });
  const page = await collectDocumentLibraryPage({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: "/api/v1",
    startOffset: 0,
    pageSize: 10,
    existingJobIds: new Set(["j1", syntheticLibraryJobId("d2")]),
    query: "",
  });
  assert.equal(page.collected.length, 0, "两条都已在既有集合里");
  assert.equal(page.hasMore, false);
  assert.equal(page.total, 2);
});

test("搜索:客户端按标题过滤并返回筛选后 total", async () => {
  const documents = [
    { document_id: "d1", active_job_id: null, title: "量子化学导论" },
    { document_id: "d2", active_job_id: null, title: "机器学习基础" },
    { document_id: "d3", active_job_id: null, source_filename: "quantum-notes.pdf" },
  ];
  const { fetchDocumentList, fetchLibraryBookList, calls } = makeFetchers({ documents, total: 3, books: [] });
  const page = await collectDocumentLibraryPage({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: "/api/v1",
    startOffset: 0,
    pageSize: 2,
    existingJobIds: new Set(),
    query: "量子",
  });
  assert.equal(page.collected.length, 1);
  assert.equal(page.collected[0].document_id, "d1");
  assert.equal(page.total, 1, "搜索 total 应是过滤后命中数");
  assert.equal(page.hasMore, false, "一条命中不需要下一页");
  assert.ok((calls.documentQuery.limit || 0) >= 200, "搜索时一次多拉一批");
});

test("搜索:筛选结果也按 24 条真正分页", async () => {
  const documents = Array.from({ length: 30 }, (_, index) => ({
    document_id: `d-${index + 1}`,
    active_job_id: null,
    title: `分页搜索结果 ${index + 1}`,
  }));
  const { fetchDocumentList, fetchLibraryBookList } = makeFetchers({ documents, total: 30, books: [] });
  const firstPage = await collectDocumentLibraryPage({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: "/api/v1",
    startOffset: 0,
    pageSize: 24,
    existingJobIds: new Set(),
    query: "分页搜索",
  });
  const secondPage = await collectDocumentLibraryPage({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: "/api/v1",
    startOffset: 24,
    pageSize: 24,
    existingJobIds: new Set(),
    query: "分页搜索",
  });

  assert.equal(firstPage.total, 30);
  assert.equal(firstPage.collected.length, 24);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.total, 30);
  assert.equal(secondPage.collected.length, 6);
  assert.equal(secondPage.hasMore, false);
});
