// 组装 HomeServices 对外 bag（HomeApp / useHomeServices 消费）。

import type {
  HomeBridge,
  HomeFeatures,
  HomeServices,
  HomeServicesDomains,
  HomeServicesViews,
  LibraryCardItem,
} from "./types.js";

export function buildHomeServices({
  bridge,
  features,
  initialize,
  dispose,
  ports,
  views,
  domains,
}: {
  bridge: HomeBridge;
  features: HomeFeatures;
  initialize: () => void;
  dispose: () => void;
  ports: HomeServices["ports"];
  views: HomeServicesViews;
  domains: HomeServicesDomains;
}): HomeServices {
  const {
    credentials,
    glossaries,
    appUpdate,
    status,
    library,
  } = domains;

  return {
    bridge,
    dispose,
    features,
    initialize,
    ports,
    stores: {
      dialog: ports.dialogStatePort.store,
      homeState: ports.homeStatePort.store,
      statusArea: views.statusArea.store,
      text: views.textStore.store,
      uploadView: views.uploadView.store,
      workflowView: views.workflowView.store,
      credentialsView: credentials.credentialsView.store,
    },
    statusArea: views.statusArea,
    credentials: {
      feature: features.browserCredentialsFeature,
      view: credentials.credentialsView,
      dialogStore: credentials.credentialsDialogStore,
    },
    settingsHub: {
      dialogStore: credentials.settingsHubDialogStore,
    },
    glossaries: {
      feature: features.glossariesFeature,
      view: glossaries.glossariesView,
      dialogStore: glossaries.glossariesDialogStore,
    },
    appUpdate: {
      feature: features.appUpdateFeature,
      view: appUpdate.appUpdateView,
      handlersRef: appUpdate.appUpdateView.handlersRef,
    },
    library: {
      viewPort: library.recentJobsViewPort,
      recentJobsStore: library.recentJobsStatePort.store,
      actions: {
        ...library.recentJobActions,
        // 网格选任务 → 详情翻译 Tab（永不弹 #translation-workflow-dialog）
        selectJob: (jobId: string) => {
          library.libraryController.selectJobForDetail(jobId, {
            findItem: (id) => {
              const items = library.recentJobsStatePort.getSnapshot().items || [];
              const match = (
                items.find((row) => `${row?.job_id || ""}`.trim() === id)
                || items.find((row) => `${row?.active_job_id || ""}`.trim() === id)
                || null
              );
              return match as unknown as LibraryCardItem | null;
            },
          });
        },
        openSourceReader: library.libraryController.openSourceReader,
        translateDocument: library.libraryController.translateDocument,
        deleteDocument: library.libraryController.deleteDocument,
        deleteDocuments: library.libraryController.deleteDocuments,
        deleteCard: library.libraryController.deleteCard,
        openBookDetail: library.libraryController.openBookDetail,
        updateDocument: library.libraryController.updateDocument,
        storeOnly: library.libraryController.storeOnly,
        attachJobProgress: library.libraryController.attachJobProgress,
      },
    },
    bookDetail: {
      dialogStore: library.bookDetailStore,
    },
    collections: {
      controller: library.collectionsController,
      dialogStore: library.collectionManageDialogStore,
      reloadSignal: library.collectionsReloadSignal,
    },
    artifactDownloads: {
      busyStore: status.artifactDownloadBusyStore,
    },
    statusCard: {
      store: status.statusCardStore,
      cancelCurrentJob: () => features.jobRuntimeFeature.cancelCurrentJob(),
    },
    statusDetail: {
      store: status.statusDetailStore,
      dialogStore: status.statusDetailDialogStore,
      controller: status.statusDetailController,
    },
    reader: {
      openReader: library.recentJobsReaderPort.openReader,
    },
    textOf: views.textStore.textOf,
    uploadDomRefs: views.uploadView.domRefs,
    uploadViewActions: {
      patch: views.uploadView.patch,
    },
    workflowViewActions: {
      setSelectedGlossaryId: views.workflowView.setSelectedGlossaryId,
    },
    workflowDialog: views.workflowDialog,
  };
}
