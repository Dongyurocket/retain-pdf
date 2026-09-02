// 图书馆(文档)域的动作集合 —— 从 composition.js 抽出来的(重构①)。
//
// composition.js 只负责 new 一次 + 把返回值接进 services.library.actions。
//
// 依赖经参数注入(不直接 import composition 作用域的东西):
// - documentRef / libraryEventPort / reloadRecentJobs / deleteJob / buildTranslateConfig
// - startPolling: job-runtime 开始盯某个 job（composition 传闭包,调用时再取 feature）
// - hideStatusArea: 静默接进度时不要抬起主页工作流状态区
//
// 进度接入契约（与 selectJob 刻意分叉）:
// - selectJob（recent-jobs/actions）→ 打开工作流弹窗 + startPolling
// - attachJobProgress（本 controller）→ 只 startPolling，不弹窗、不亮主状态区
//   供书籍详情「翻译」Tab 内嵌 StatusCard 使用。

import { createBookDetailDialogStore } from "../detail/book-detail-dialog-store.js";
import type {
  DeleteCardTarget,
  DeleteDocumentsResult,
  JobSubmissionView,
  LibraryCardItem,
  LibraryController,
  LibraryControllerDeps,
  ReloadRecentJobsOptions,
  TranslateDocumentPayload,
  UpdateDocumentPayload,
} from "../types.js";
import {
  translateDocument,
  deleteDocument,
  patchDocument,
  API_PREFIX,
  APP_EVENTS,
  addDocumentTombstone,
} from "../../../composition/external.js";

type ErrorLike = {
  message?: string;
  status?: number;
} | string | null | undefined;

export function createLibraryController({
  documentRef,
  libraryEventPort,
  reloadRecentJobs,
  removeLibraryDocuments,
  patchLibraryDocumentItem,
  deleteJob,
  buildTranslateConfig,
  startPolling,
  hideStatusArea,
}: LibraryControllerDeps = {}): LibraryController {
  const bookDetailStore = createBookDetailDialogStore();
  const translatingDocumentIds = new Set<string>();

  function dispatchAppEvent(name: string, detail?: unknown) {
    if (documentRef?.dispatchEvent && typeof globalThis.CustomEvent === "function") {
      documentRef.dispatchEvent(
        new globalThis.CustomEvent(name, detail === undefined ? undefined : { detail }),
      );
    }
  }

  async function reload(opts?: ReloadRecentJobsOptions) {
    await reloadRecentJobs?.(opts);
  }

  // F4 馆藏文档"读原文":无 job,派发带 documentId 的 openReaderRequested,
  // ReaderDialog 用 document_id 打开只读源文档阅读器(与卡片对照阅读同一事件契约)。
  function openSourceReader(documentId?: string | null) {
    const normalizedId = `${documentId || ""}`.trim();
    if (!normalizedId) {
      return;
    }
    dispatchAppEvent(APP_EVENTS.openReaderRequested, { documentId: normalizedId, pageIdx: null, blockId: "" });
  }

  // F3 "只入库,不翻译":PDF 在**上传完成那一刻**后端就已经建好 document 了
  // (POST /uploads → upsert_document_from_upload,document_id = 内容哈希),
  // 所以"只入库"不需要任何新接口——就是**不提交翻译 job**:关掉工作流对话框
  // (其 close() 顺带 resetUploadSession + bindings 里 scheduleRefresh soft)。
  // 不再额外 force refresh，避免关对话框连闪两次。
  function storeUploadedDocumentOnly() {
    dispatchAppEvent(APP_EVENTS.closeTranslationWorkflow);
  }

  // 翻译失败的友好文案:后端最常见的失败是"没配 OCR/翻译凭据"
  // (如 paddle_token is required),原文对用户没意义,给一句可操作提示;其余
  // 错误至少把后端消息透出来(不再静默)。
  function friendlyTranslateError(error: ErrorLike) {
    const message = typeof error === "string" ? error : `${error?.message || error || ""}`;
    const credentialish = /(token|key|凭据|令牌|密钥|credential)/i.test(message);
    const missing = /(required|需要|缺|未配置|not configured|missing)/i.test(message);
    if (credentialish && missing) {
      return "翻译需要先在「设置」里配置 OCR / 翻译凭据后再试。";
    }
    return message || "发起翻译失败，请稍后重试。";
  }

  // F5 馆藏文档"以后再翻":复用文档已存的 upload 起 book 翻译 job,后端回填
  // active_job_id;随后整页重载一次——该文档会以真实 job_id 重新进网格,现有
  // 轮询引擎(active-refresh 按 job_id 拉 job payload)自然接管进度。
  //
  // 失败时**抛给调用方**(书籍详情弹窗在弹窗内 setError 展示 + 不关闭弹窗)。
  // 早期这里往网格 renderError,但翻译入口已从卡片挪进弹窗,而网格错误条只在
  // "网格为空"时才显示、满网格时用户根本看不到——表现成"点了没反应"(缺
  // OCR 凭据时的真实 bug)。
  // 组装真正发给后端的 job 配置:先从已配置凭据拼出完整的 ocr(PaddleOCR)+
  // translation(DeepSeek)基座(buildTranslateConfig),再把弹窗传来的页码范围
  // (payload.ocr.page_ranges / payload.translation.start_page-end_page)叠上去。
  // 不带凭据的话后端收不到 provider,会默认到已废弃的 OCR provider 而失败。
  function assembleTranslatePayload(overrides: TranslateDocumentPayload = {}): TranslateDocumentPayload {
    const pageRanges = `${overrides?.ocr?.page_ranges || ""}`.trim();
    const base = (buildTranslateConfig?.(pageRanges) || {}) as TranslateDocumentPayload;
    return {
      ...(base.ocr ? { ocr: { ...base.ocr, ...(overrides.ocr || {}) } } : (overrides.ocr ? { ocr: overrides.ocr } : {})),
      ...(base.translation ? { translation: { ...base.translation, ...(overrides.translation || {}) } } : (overrides.translation ? { translation: overrides.translation } : {})),
    };
  }

  /**
   * 静默接入任务进度（书籍详情翻译 Tab → bd-job-status-inner）。
   * - silent startPolling：只写 statusCardStore，不抬工作流区、不广播 create
   * - 绝不 dispatch openTranslationWorkflow（进度主场在详情，不在弹窗）
   * - 强制 hide 主状态区，避免 #status-section / 主 StatusCard 抢戏
   */
  function attachJobProgress(jobId?: string | null) {
    const id = `${jobId || ""}`.trim();
    if (!id || id.startsWith("doc:")) {
      return;
    }
    hideStatusArea?.();
    startPolling?.(id, { silent: true, showWorkflow: false, publishLibrary: false });
    hideStatusArea?.();
  }

  /**
   * 翻译成功后的即时反馈（不等整页重载）:
   * 1) 详情 payload 立刻挂上真实 job_id → 翻译 Tab 切到 StatusCard
   * 2) attachJobProgress → 进度环/阶段流马上动
   * 3) publishJobUpdated 按 document_id 就地更新原卡（禁止插第二张）
   * 4) 后台 silent 刷新对齐服务端，不闪 loading
   */
  function promoteDocumentToJob(
    documentId: string,
    result: JobSubmissionView | null | undefined,
  ) {
    const jobId = `${result?.job_id || result?.id || ""}`.trim();
    if (!jobId) {
      return;
    }
    const dialogState = bookDetailStore.getState();
    const base = (dialogState.payload || {}) as LibraryCardItem;
    const status = `${result?.status || "queued"}`.trim() || "queued";
    const stage = `${result?.stage || result?.display_stage || "queued"}`.trim() || "queued";

    if (dialogState.open && `${base.document_id || ""}`.trim() === documentId) {
      bookDetailStore.open({
        ...base,
        job_id: jobId,
        active_job_id: jobId,
        library_only: false,
        status,
        stage,
        display_stage: `${result?.display_stage || stage}`,
      });
    }

    // 用 JobUpdated：按 document_id 就地改原卡，禁止主页再插一张新书
    const previousJobId = `${base.job_id || ""}`.trim();
    libraryEventPort?.publishJobUpdated?.({
      job_id: jobId,
      source_job_id: previousJobId && previousJobId !== jobId ? previousJobId : undefined,
      document_id: documentId,
      active_job_id: jobId,
      library_only: false,
      status,
      stage,
      display_stage: `${result?.display_stage || stage}`,
      title: base.title,
      display_name: base.display_name || base.title,
      page_count: base.page_count,
      cover_url: base.cover_url,
      thumbnail_url: base.thumbnail_url,
    });
    attachJobProgress(jobId);
  }

  async function translateLibraryDocument(
    documentId?: string | null,
    payload: TranslateDocumentPayload = {},
  ): Promise<JobSubmissionView | null> {
    const normalizedId = `${documentId || ""}`.trim();
    if (!normalizedId || translatingDocumentIds.has(normalizedId)) {
      return null;
    }
    translatingDocumentIds.add(normalizedId);
    let result: JobSubmissionView | null = null;
    try {
      result = (await translateDocument(
        API_PREFIX,
        normalizedId,
        assembleTranslatePayload(payload),
      )) as JobSubmissionView;
    } catch (error) {
      throw new Error(friendlyTranslateError(error as ErrorLike));
    } finally {
      translatingDocumentIds.delete(normalizedId);
    }

    // 立刻接进度 + 更新详情/网格；不再整页 reload（运行中由单卡 patch 推进）
    promoteDocumentToJob(normalizedId, result);
    return result;
  }

  // 文档级删除(后端补了 DELETE /documents/:id 之后):删掉 document + 名下所有
  // job/upload/文件。馆藏文档和已翻译文档统一走这条(卡片都带 document_id)。
  function friendlyDocumentDeleteError(error: ErrorLike) {
    const message = typeof error === "string" ? error : `${error?.message || error || ""}`;
    const status = typeof error === "object" && error ? error.status : undefined;
    if (status === 409 || message.includes("(409)")) {
      const count = message.match(/\d+/)?.[0];
      return count
        ? `该文档有 ${count} 条收藏，请先删除收藏后再删除文档。`
        : "该文档存在收藏引用，请先删除相关收藏后再删除文档。";
    }
    return message || "删除文档失败";
  }

  // 同翻译:失败抛给调用方(弹窗内展示)。成功后乐观删卡 + 静默 soft reload，
  // 不再 await 非 silent 整页 loading（主页闪空根因之一）。
  async function deleteLibraryDocument(documentId?: string | null) {
    const normalizedId = `${documentId || ""}`.trim();
    if (!normalizedId) {
      return;
    }
    try {
      await deleteDocument(API_PREFIX, normalizedId);
    } catch (error) {
      throw new Error(friendlyDocumentDeleteError(error as ErrorLike));
    }
    // 墓碑:删除成功后即使后端投影/轮询竞态也不让条目复活
    addDocumentTombstone(normalizedId);
    removeLibraryDocuments?.([normalizedId]);
    // preservePage:停留在当前页 soft 对齐,不跳回第 1 页
    void reload({ reset: true, silent: true, preservePage: true });
  }

  // 批量删除:API 仍逐个 delete；网格乐观一次移除 + 单次 silent soft reload。
  async function deleteLibraryDocuments(
    documentIds: Array<string | null | undefined> = [],
  ): Promise<DeleteDocumentsResult> {
    const ids = [...new Set((documentIds || []).map((id) => `${id || ""}`.trim()).filter(Boolean))];
    if (!ids.length) {
      return { confirmed: 0, failed: 0 };
    }
    const results = await Promise.allSettled(ids.map((id) => deleteDocument(API_PREFIX, id)));
    const confirmedIds = ids.filter((_, index) => results[index]?.status === "fulfilled");
    const confirmed = confirmedIds.length;
    if (confirmedIds.length) {
      confirmedIds.forEach((id) => addDocumentTombstone(id));
      removeLibraryDocuments?.(confirmedIds);
    }
    void reload({ reset: true, silent: true, preservePage: true });
    return { confirmed, failed: results.length - confirmed };
  }

  // 卡片删除入口:有 document_id 走文档级删除(删整篇文档 + 名下所有 job);
  // 没有(极少见的运行时插入 job 项)退回老的 job 删除,保留原行为。
  function deleteCard(target: DeleteCardTarget = {}) {
    const documentId = `${target?.documentId || ""}`.trim();
    if (documentId) {
      // fire-and-forget:deleteLibraryDocument 现在会 throw,吞掉避免未处理拒绝
      // (这条卡片级入口目前无消费方,卡片删除已并进详情弹窗)。
      void deleteLibraryDocument(documentId).catch(() => {});
      return;
    }
    deleteJob?.(`${target?.jobId || ""}`.trim());
  }

  function shouldPreferTranslateTab(item?: LibraryCardItem | null) {
    if (item?.prefer_translate_tab) return true;
    const status = `${item?.status || ""}`.trim().toLowerCase();
    if (status === "failed" || status === "running" || status === "queued" || status === "pending") {
      return true;
    }
    const jobId = `${item?.job_id || item?.active_job_id || ""}`.trim();
    // 有真实 job 且非馆藏合成 id → 默认看翻译 Tab 进度
    if (jobId && !jobId.startsWith("doc:") && !item?.library_only) {
      return true;
    }
    return false;
  }

  // 书籍详情弹窗：点卡片打开。运行中/失败默认落翻译 Tab + silent 进度，
  // 绝不打开 #translation-workflow-dialog。
  function openBookDetail(item?: LibraryCardItem | null) {
    if (!item) return;
    const documentId = `${item.document_id || ""}`.trim();
    const jobId = `${item.job_id || item.active_job_id || ""}`.trim();
    // 至少要有 document_id 或真实 job_id
    if (!documentId && (!jobId || jobId.startsWith("doc:"))) {
      return;
    }
    const prefer = shouldPreferTranslateTab(item);
    bookDetailStore.open({
      ...item,
      prefer_translate_tab: prefer || Boolean(item.prefer_translate_tab),
    });
    if (jobId && !jobId.startsWith("doc:")) {
      attachJobProgress(jobId);
    }
  }

  /**
   * 网格「选中任务」：一律进详情翻译 Tab + silent 进度。
   * 不再 fallback 到 openTranslationWorkflow（旧弹窗只留给底部「添加」）。
   */
  function selectJobForDetail(
    jobId?: string | null,
    options: {
      findItem?: (jobId: string) => LibraryCardItem | null | undefined;
      /** @deprecated 图书馆网格不再弹工作流；保留参数兼容测试注入 */
      fallbackSelectJob?: (jobId: string) => void;
    } = {},
  ) {
    const id = `${jobId || ""}`.trim();
    if (!id) {
      return;
    }
    const item = options.findItem?.(id) || null;
    if (item) {
      openBookDetail({
        ...item,
        prefer_translate_tab: true,
      });
      return;
    }
    // 网格里暂时找不到行：仍用 job_id 打开详情壳 + silent 轮询，不弹旧窗
    openBookDetail({
      job_id: id,
      prefer_translate_tab: true,
      status: "running",
    });
  }

  // 详情弹窗里改标题/标签/阅读状态:PATCH 后乐观写网格/详情，再后台 silent soft 对齐。
  async function updateLibraryDocument(
    documentId?: string | null,
    payload: UpdateDocumentPayload = {},
  ): Promise<unknown> {
    const normalizedId = `${documentId || ""}`.trim();
    if (!normalizedId) {
      return null;
    }
    const updated = await patchDocument(API_PREFIX, normalizedId, payload) as Record<string, unknown> | null;
    const patch: Partial<LibraryCardItem> = {
      ...(payload.title !== undefined
        ? {
          title: `${updated?.title ?? payload.title ?? ""}`,
          display_name: `${updated?.title ?? payload.title ?? ""}`,
        }
        : {}),
      ...(payload.reading_status !== undefined
        ? { reading_status: `${updated?.reading_status ?? payload.reading_status ?? ""}` }
        : {}),
      ...(payload.tags !== undefined
        ? { tags: (Array.isArray(updated?.tags) ? updated.tags : payload.tags) as string[] }
        : {}),
    };
    if (Object.keys(patch).length) {
      patchLibraryDocumentItem?.(normalizedId, patch);
      const dialogState = bookDetailStore.getState();
      const base = dialogState.payload;
      if (dialogState.open && base && `${base.document_id || ""}`.trim() === normalizedId) {
        bookDetailStore.open({ ...base, ...patch });
      }
    }
    void reload({ reset: true, silent: true });
    return updated;
  }

  return {
    bookDetailStore,
    // 键名对齐 services.library.actions 的既有契约(消费方 RecentJobsLibrary /
    // BookDetailDialog / CategoriesView 不用改)。
    openSourceReader,
    storeOnly: storeUploadedDocumentOnly,
    translateDocument: translateLibraryDocument,
    deleteDocument: deleteLibraryDocument,
    deleteDocuments: deleteLibraryDocuments,
    deleteCard,
    openBookDetail,
    selectJobForDetail,
    updateDocument: updateLibraryDocument,
    /** 详情内嵌进度：静默轮询，不弹 #translation-workflow-dialog */
    attachJobProgress,
  };
}
