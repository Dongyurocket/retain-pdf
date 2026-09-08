// recent-jobs ports + library controller + collections。

import {
  API_PREFIX,
  APP_EVENTS,
  createStore,
  createRecentJobsStatePort,
  createRecentJobActions,
  createRecentJobsRuntimePort,
  createRecentJobsReaderPort,
  createRecentJobsNavigationPort,
  createRecentJobsLibraryRefreshPort,
  readActiveJobId,
  deleteLibraryBook,
  fetchDocumentList,
  fetchLibraryBookList,
  createDocumentLibraryResource,
} from "./external.js";
import {
  createLibraryController,
  createRecentJobsReactViewPort,
} from "../features/library/index.js";
import { createCollectionsController } from "../features/collections/controller.js";
import { createCollectionManageDialogStore } from "../features/collections/collection-manage-dialog-store.js";
import type {
  CollectionsController,
  CollectionsReloadSignal,
  HomeFeatures,
  RecentJobActions,
} from "./types.js";
import type {
  LibraryController,
  RecentJobsReactViewPort,
  ReloadRecentJobsOptions,
} from "../features/library/types.js";
import type { DialogStore } from "../state/dialog-store.js";
import type { LibraryCardItem } from "../features/library/types.js";

type ReaderAnchor = {
  pageIdx?: number | null;
  blockId?: string;
} | null;

type CreateLibraryDomainArgs = {
  features: HomeFeatures;
  documentRef: Document;
  statusArea: { setVisible: (visible: boolean) => void };
};

export function createLibraryDomain({ features, documentRef, statusArea }: CreateLibraryDomainArgs) {
  const libraryEventPort = createRecentJobsLibraryRefreshPort({ target: documentRef });
  const recentJobsStatePort = createRecentJobsStatePort();
  const recentJobsViewPort = createRecentJobsReactViewPort() as RecentJobsReactViewPort;
  const documentLibraryResource = createDocumentLibraryResource({
    fetchDocumentList,
    fetchLibraryBookList,
    apiPrefix: API_PREFIX,
  });

  // 下层 port 工厂 `= {}` 默认参会丢掉无默认字段（openJob / closeDialog 等）。
  const recentJobsJobRuntimePort = createRecentJobsRuntimePort({
    // 网格点任务：仅 silent 轮询（进度在详情 Tab）；不抬主工作流
    openJob: (jobId: string) => (
      features.jobRuntimeFeature.startPolling(jobId, {
        silent: true,
        showWorkflow: false,
        publishLibrary: false,
      })
    ),
    // 冷启动恢复活跃任务：silent，不抬主状态区、不刷库 create 事件
    recoverJob: (jobId: string) => (
      features.jobRuntimeFeature.startPolling(jobId, { silent: true })
    ),
    currentJobId: () => features.jobRuntimeFeature.currentJobId() || "",
  });

  const recentJobsReaderPort = createRecentJobsReaderPort({
    openReader: (jobId: string, anchor: ReaderAnchor = null) => {
      const normalizedJobId = `${jobId || ""}`.trim();
      if (!normalizedJobId) return;
      // 阅读器不需要抬主工作流区 / 刷库 create；silent 盯 job 即可
      features.jobRuntimeFeature.startPolling(normalizedJobId, { silent: true });
      documentRef.dispatchEvent(new globalThis.CustomEvent(APP_EVENTS.openReaderRequested, {
        detail: {
          jobId: normalizedJobId,
          pageIdx: Number.isFinite(anchor?.pageIdx) ? anchor.pageIdx : null,
          blockId: anchor?.blockId || "",
        },
      }));
    },
  });

  const recentJobsNavigationPort = createRecentJobsNavigationPort({
    closeDialog: () => {},
    currentJobId: () => features.jobRuntimeFeature.currentJobId() || "",
    jobRuntimePort: recentJobsJobRuntimePort,
    readerPort: recentJobsReaderPort,
    doc: documentRef,
  });

  // startPolling/openReader/closeRecentJobsDialog 可由 navigationPort 兜底；签名仍标必填。
  const recentJobActions = {
    ...createRecentJobActions({
    apiPrefix: API_PREFIX,
    deleteLibraryBook,
    activeJobRecoveryPort: { readActiveJobId },
    navigationPort: recentJobsNavigationPort,
    renderCurrentRecentJobs: () => {},
    renderRecentJobsEmpty: recentJobsViewPort.renderEmpty,
    renderRecentJobsError: recentJobsViewPort.renderError,
    statePort: recentJobsStatePort,
  }),
    refresh: () => libraryEventPort.requestRefresh({ force: true }),
  } as RecentJobActions & { refresh: () => unknown };

  const libraryController = createLibraryController({
    documentRef,
    libraryEventPort,
    reloadRecentJobs: async (opts?: ReloadRecentJobsOptions) => {
      await features.recentJobsFeature.loadRecentJobs(opts);
    },
    removeLibraryDocuments: (documentIds: string[]) => {
      const idSet = new Set((documentIds || []).map((id) => `${id || ""}`.trim()).filter(Boolean));
      if (!idSet.size) {
        return;
      }
      const { items } = recentJobsStatePort.getSnapshot();
      recentJobsStatePort.setItems(
        items.filter((item) => !idSet.has(`${item?.document_id || ""}`.trim())),
      );
    },
    patchLibraryDocumentItem: (documentId: string, patch) => {
      const id = `${documentId || ""}`.trim();
      if (!id || !patch || typeof patch !== "object") {
        return;
      }
      const { items } = recentJobsStatePort.getSnapshot();
      recentJobsStatePort.setItems(
        items.map((item) => (
          `${item?.document_id || ""}`.trim() === id ? { ...item, ...patch } : item
        )),
      );
    },
    deleteJob: async (jobId: string) => {
      await recentJobActions.deleteJob(jobId);
    },
    buildTranslateConfig: (pageRanges?: string) => features.workflowFeature.buildTranslateJobConfig(pageRanges),
    startPolling: (jobId: string, options?: { silent?: boolean }) => {
      features.jobRuntimeFeature.startPolling(jobId, options);
    },
    hideStatusArea: () => statusArea.setVisible(false),
  }) as LibraryController;

  return {
    libraryEventPort,
    recentJobsStatePort,
    recentJobsViewPort,
    documentLibraryResource,
    recentJobsJobRuntimePort,
    recentJobsReaderPort,
    recentJobsNavigationPort,
    recentJobActions,
    libraryController,
    bookDetailStore: libraryController.bookDetailStore as DialogStore<LibraryCardItem | null>,
    collectionsController: createCollectionsController({ apiPrefix: API_PREFIX }) as unknown as CollectionsController,
    collectionManageDialogStore: createCollectionManageDialogStore(),
    collectionsReloadSignal: createStore<
      { version: number },
      { bump: (state: { version: number }) => { version: number } }
    >({
      name: "collectionsReload",
      initialState: { version: 0 },
      actions: {
        bump: (state) => ({ version: state.version + 1 }),
      },
    }) as CollectionsReloadSignal,
  };
}
