// home 页组合根：只做「顺序接线」，不写业务、不堆 import。
//
// 规则：
//   1. 所有 ../../../js/* 只在 composition/external.ts
//   2. 各 create* 工厂返回自己的 bag，这里显式赋值，禁止 Object.assign(ctx)
//   3. features 是唯一可变注册表；晚绑定通过它完成
//   4. job-runtime / recent-jobs / artifacts 在 composition 阶段一次挂齐

import {
  loadBrowserStoredConfig,
  loadDeveloperStoredConfig,
  createDeveloperState,
  setDeveloperConfig,
  createDesktopState,
  setDesktopMode,
  createHomeStatePort,
  createUploadStatePort,
  defaultCredentialsStatePort,
  validateDeepSeekToken,
  queryDeepSeekBalance,
  createTranslationWorkflowDialogStatePort,
  fetchGlossariesApi,
  fetchGlossaryApi,
  createGlossaryApi,
  updateGlossaryApi,
  deleteGlossaryApi,
  exportGlossaryCsvApi,
  parseGlossaryCsvApi,
  submitUploadRequestHttp,
  fetchLatestGithubRelease,
  defaultUpdateCachePort,
} from "./composition/external.js";

import { createHomeTextStore } from "./state/text-store.js";
import { createUploadViewFeature } from "./features/upload/upload-view-store.js";
import { createWorkflowViewFeature } from "./features/workflow/workflow-view-store.js";
import { createStatusAreaFeature } from "./features/status/status-area.js";
import { createTranslationWorkflowDialogRuntime } from "./features/workflow/translation-workflow-dialog-runtime.js";

import { safeLoad } from "./composition/safe-load.js";
import { createBridge } from "./composition/create-bridge.js";
import { createWorkflowAndUpload } from "./composition/create-workflow-upload.js";
import { createCredentials } from "./composition/create-credentials.js";
import { createGlossariesAndAppUpdate } from "./composition/create-glossaries-app-update.js";
import { createStatusDomain } from "./composition/create-status-domain.js";
import { createLibraryDomain } from "./composition/create-library-domain.js";
import { createAppActions } from "./composition/create-app-actions.js";
import { createRuntimeFeatures } from "./composition/create-runtime-features.js";
import { createLifecycle } from "./composition/create-lifecycle.js";
import { buildHomeServices } from "./composition/build-home-services.js";
import type {
  CreateHomeCompositionOptions,
  HomeFeatures,
  HomeServices,
  StatusDetailHolder,
} from "./composition/types.js";

export type { HomeServices, HomeFeatures, CreateHomeCompositionOptions } from "./composition/types.js";

export function createHomeComposition({
  documentRef = globalThis.document,
  fetchGlossaries = fetchGlossariesApi,
  submitUploadRequest = submitUploadRequestHttp,
  loadPersistedDeveloperConfig = () => safeLoad(loadDeveloperStoredConfig, {}),
  loadPersistedBrowserConfig = () => safeLoad(loadBrowserStoredConfig, loadBrowserStoredConfig()),
  validateOcrToken: validateOcrTokenOverride = null,
  validateDeepSeekToken: validateDeepSeekTokenOverride = validateDeepSeekToken,
  queryDeepSeekBalance: queryDeepSeekBalanceOverride = queryDeepSeekBalance,
  checkApiConnectivity: checkApiConnectivityOverride = null,
  saveDesktopConfig: saveDesktopConfigOverride = null,
  initialDesktopMode = false,
  fetchGlossary: fetchGlossaryOverride = fetchGlossaryApi,
  createGlossary: createGlossaryOverride = createGlossaryApi,
  updateGlossary: updateGlossaryOverride = updateGlossaryApi,
  deleteGlossary: deleteGlossaryOverride = deleteGlossaryApi,
  exportGlossaryCsv: exportGlossaryCsvOverride = exportGlossaryCsvApi,
  parseGlossaryCsv: parseGlossaryCsvOverride = parseGlossaryCsvApi,
  fetchLatestRelease: fetchLatestReleaseOverride = fetchLatestGithubRelease,
  appUpdateCachePort: appUpdateCachePortOverride = defaultUpdateCachePort,
  appUpdateAutoCheckEnabled = false,
}: CreateHomeCompositionOptions = {}): HomeServices {
  const features: HomeFeatures = {};

  // —— 基础 state / view ——
  const legacyState = { ...createDeveloperState(), ...createDesktopState() };
  setDeveloperConfig(legacyState, loadPersistedDeveloperConfig());
  setDesktopMode(legacyState, initialDesktopMode);

  const homeStatePort = createHomeStatePort({}, { eventTarget: documentRef });
  const uploadStatePort = createUploadStatePort();
  const credentialsStatePort = defaultCredentialsStatePort;
  credentialsStatePort.setCredentials(loadPersistedBrowserConfig());

  const textStore = createHomeTextStore();
  const uploadView = createUploadViewFeature();
  // 下层 view/runtime 工厂的默认参 `= {}` 会让 TS 丢掉无默认字段；运行时入参正确，此处放宽。
  const workflowView = createWorkflowViewFeature({
    uploadTilePort: uploadView.uploadTilePort,
  } as any);
  const statusArea = createStatusAreaFeature({ documentRef });
  const dialogStatePort = createTranslationWorkflowDialogStatePort({ homeStatePort });
  const workflowDialog = createTranslationWorkflowDialogRuntime({
    dialogStatePort,
    statusAreaPort: statusArea.statusAreaPort,
    uploadSessionPort: {
      resetUploadSession: () => features.uploadFeature.resetUploadSession(),
    },
    documentRef,
  } as any);

  // bridge 需要 statusDetail holder（后续 createStatusDomain 写入）
  const statusDetailHolder: StatusDetailHolder = { store: null, dialogStore: null };
  const bridge = createBridge({
    textStore,
    statusArea,
    workflowView,
    uploadView,
    uploadStatePort,
    features,
    statusDetail: statusDetailHolder,
  });

  // —— 各域（返回 bag，显式挂到 features） ——
  Object.assign(features, createWorkflowAndUpload({
    features,
    credentialsStatePort,
    workflowView,
    uploadView,
    uploadStatePort,
    bridge,
    legacyState,
    setText: bridge.setText,
    fetchGlossaries,
    submitUploadRequest,
  }));

  const credentials = createCredentials({
    features,
    legacyState,
    credentialsStatePort,
    uploadStatePort,
    validateOcrTokenOverride,
    validateDeepSeekTokenOverride,
    queryDeepSeekBalanceOverride,
    checkApiConnectivityOverride,
    saveDesktopConfigOverride,
  });
  features.browserCredentialsFeature = credentials.browserCredentialsFeature;

  const glossaries = createGlossariesAndAppUpdate({
    features,
    fetchGlossaries,
    fetchGlossary: fetchGlossaryOverride,
    createGlossary: createGlossaryOverride,
    updateGlossary: updateGlossaryOverride,
    deleteGlossary: deleteGlossaryOverride,
    exportGlossaryCsv: exportGlossaryCsvOverride,
    parseGlossaryCsv: parseGlossaryCsvOverride,
    appUpdateAutoCheckEnabled,
    appUpdateCachePort: appUpdateCachePortOverride,
    fetchLatestRelease: fetchLatestReleaseOverride,
  });
  features.glossariesFeature = glossaries.glossariesFeature;
  features.appUpdateFeature = glossaries.appUpdateFeature;

  const status = createStatusDomain({
    features,
    documentRef,
    bridge,
    setText: bridge.setText,
    statusDetailHolder,
  });

  const library = createLibraryDomain({ features, documentRef, statusArea });

  const { appActionsFeature } = createAppActions({
    features,
    bridge,
    setText: bridge.setText,
    workflowView,
    uploadView,
    uploadStatePort,
    legacyState,
    jobRuntimeState: status.jobRuntimeState,
    statusCardPresenter: status.statusCardPresenter,
    libraryEventPort: library.libraryEventPort,
    settingsHubDialogStore: credentials.settingsHubDialogStore,
  });
  features.appActionsFeature = appActionsFeature;

  // 必须先于 recent-jobs 注册 closeTranslationWorkflow 监听：
  // recent-jobs 的 scheduleRefresh 会同步读 isWorkflowOpen(DOM data-open)；
  // 若 workflow 的 close() 还没把 data-open 写成 0，刷新会被 isSuspended 吞掉（蓝图风险 5）。
  const disposeWorkflowDialogEvents = workflowDialog.bindEvents();

  // job-runtime / recent-jobs / artifacts：一次挂齐
  Object.assign(features, createRuntimeFeatures({
    features,
    bridge,
    jobRuntimeState: status.jobRuntimeState,
    statusCardPresenter: status.statusCardPresenter,
    uploadStatePort,
    libraryEventPort: library.libraryEventPort,
    jobRuntimeShellViewPort: status.jobRuntimeShellViewPort,
    artifactDownloadsViewPort: status.artifactDownloadsViewPort,
    recentJobsStatePort: library.recentJobsStatePort,
    recentJobsViewPort: library.recentJobsViewPort,
    recentJobsJobRuntimePort: library.recentJobsJobRuntimePort,
    recentJobsReaderPort: library.recentJobsReaderPort,
    recentJobsNavigationPort: library.recentJobsNavigationPort,
    documentLibraryResource: library.documentLibraryResource,
    homeStatePort,
  }));

  const lifecycle = createLifecycle({
    features,
    bridge,
    documentRef,
    disposeWorkflowDialogEvents,
  });
  features.appShellFeature = lifecycle.appShellFeature;

  return buildHomeServices({
    bridge,
    features,
    initialize: lifecycle.initialize,
    dispose: lifecycle.dispose,
    ports: {
      credentialsStatePort,
      dialogStatePort,
      homeStatePort,
      uploadStatePort,
    },
    views: {
      textStore,
      uploadView,
      workflowView,
      statusArea,
      workflowDialog,
    },
    domains: {
      credentials,
      glossaries,
      appUpdate: glossaries,
      status,
      library,
    },
  });
}
