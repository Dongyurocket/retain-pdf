// composition 层公共类型。HomeServices / HomeFeatures 表面 API 不用 any；
// 深层 payload 用 unknown；store/port 复用已有模块类型。

import type {
  Store,
  CredentialsStatePort,
  HomeStatePort,
  UploadStatePort,
  TranslationWorkflowDialogStatePort,
  RecentJobsStatePort,
} from "./external.js";
import type { DialogStore } from "../state/dialog-store.js";
import type { ArtifactDownloadBusyStore } from "../state/artifact-download-busy-store.js";
import type {
  DeleteCardTarget,
  DeleteDocumentsResult,
  JobSubmissionView,
  LibraryCardItem,
  LibraryController,
  RecentJobsReactViewPort,
  TranslateDocumentPayload,
  UpdateDocumentPayload,
} from "../features/library/types.js";

/**
 * 通用 app-framework store。
 * 用 Store 默认参（未建模 snapshot/actions），避免把消费方推成 never/unknown。
 */
export type AppStore = Store;

// ── Features ──────────────────────────────────────────────────────────

export type WorkflowFeature = {
  applyWorkflowMode: () => void;
  buildTranslateJobConfig: (pageRanges?: string) => TranslateDocumentPayload | Record<string, unknown>;
  collectRunPayload: () => unknown;
  currentRenderSourceJobId: () => string;
  currentWorkflow: () => string;
  currentBudgetState: (workflow?: string) => unknown;
  developerConfigWithDefaults: () => Record<string, unknown>;
  loadGlossaryOptions: (options?: unknown) => unknown;
  refreshSubmitControls: () => void;
  resetDeveloperDialog: () => void;
  saveDeveloperDialog: () => unknown;
  syncDeveloperDialogFromState: () => void;
  updateCredentialGate: (options?: unknown) => void;
  updateDeveloperWorkflowFormState: () => void;
  workflowNeedsCredentials: (workflow?: string) => boolean;
  workflowNeedsUpload: (workflow?: string) => boolean;
};

export type UploadFeature = {
  applyPageRanges: () => void;
  clearPageRanges: () => void;
  constrainPageRanges: (options?: { source?: unknown }) => void;
  currentPageRanges: () => string;
  handleFileSelected: () => unknown;
  normalizePageRangeValue: (start?: unknown, end?: unknown) => string;
  openPageRangeDialog: () => void;
  renderPageRangeSummary: () => void;
  resetUploadSession: () => void;
  validatePageRanges: () => boolean;
};

export type BrowserCredentialsFeature = {
  activateCredentialTab: (tabName?: string) => void;
  ensureOcrCredentialsReady: (options?: unknown) => Promise<boolean> | boolean | unknown;
  hasBrowserCredentials: () => boolean;
  openBrowserCredentialsDialog: (options?: unknown) => void;
  prepareCredentialsPanels?: () => void;
  refreshDeepSeekBalance: (options?: unknown) => Promise<unknown> | unknown;
  setDialogStatus: (message?: string, tone?: string) => void;
  updateCredentialGate: (options?: unknown) => void;
};

export type GlossariesFeature = {
  bindEvents: () => void;
  open: () => unknown;
  reloadGlossaries: () => unknown;
  save: () => unknown;
};

export type AppUpdateFeature = {
  checkForUpdates: (options?: { manual?: boolean }) => Promise<unknown> | unknown;
};

export type AppActionsFeature = {
  checkApiConnectivity: () => Promise<unknown> | unknown;
  handleOpenOutputDir: () => unknown;
  /** React SubmitEvent 与 DOM Event 均允许 */
  submitForm: (event?: { preventDefault?: () => void } | null) => unknown;
};

export type StartPollingOptions = {
  silent?: boolean;
  publishLibrary?: boolean;
  showWorkflow?: boolean;
};

export type JobRuntimeFeature = {
  cancelCurrentJob: () => unknown;
  currentJobId: () => string;
  fetchJob: (jobId?: string) => Promise<unknown> | unknown;
  retryStage: (stage: string, options?: { jobId?: string; forceFullReprocess?: boolean }) => unknown;
  returnToHome: () => void;
  startPolling: (jobId: string, options?: StartPollingOptions) => unknown;
  stopPolling: () => void;
};

export type RecentJobsFeature = {
  openRecentJobsDialog: () => void;
  closeRecentJobsDialog: () => void;
  loadRecentJobs: (options?: unknown) => Promise<unknown> | unknown;
  initializeLibraryView: () => void;
};

export type ArtifactDownloadsFeature = {
  bindEvents: () => void;
  handleProtectedArtifactClick: (event: Event, link?: Element) => unknown;
};

export type AppShellFeature = {
  initializeIdleView: () => void;
};

/** 装配期逐步填满的 features 注册表 */
export type HomeFeatures = {
  workflowFeature?: WorkflowFeature;
  uploadFeature?: UploadFeature;
  browserCredentialsFeature?: BrowserCredentialsFeature;
  glossariesFeature?: GlossariesFeature;
  appUpdateFeature?: AppUpdateFeature;
  appActionsFeature?: AppActionsFeature;
  jobRuntimeFeature?: JobRuntimeFeature;
  recentJobsFeature?: RecentJobsFeature;
  artifactDownloadsFeature?: ArtifactDownloadsFeature;
  appShellFeature?: AppShellFeature;
};

// ── Ports / stores ────────────────────────────────────────────────────

export type { CredentialsStatePort, HomeStatePort, UploadStatePort };
export type DialogStatePort = TranslationWorkflowDialogStatePort;

export type HomePorts = {
  credentialsStatePort: CredentialsStatePort;
  dialogStatePort: DialogStatePort;
  homeStatePort: HomeStatePort;
  uploadStatePort: UploadStatePort;
};

export type HomeStores = {
  dialog: AppStore;
  homeState: AppStore;
  statusArea: AppStore;
  text: AppStore;
  uploadView: AppStore;
  workflowView: AppStore;
  credentialsView: AppStore;
};

// ── Domain bags ───────────────────────────────────────────────────────

/** 事件处理函数表（viewPort.bindEvents 写入 handlersRef） */
export type HandlersBag = {
  [key: string]: ((...args: unknown[]) => unknown) | undefined | null;
};

export type CredentialsElementsRef = {
  apiKeyInput: HTMLInputElement | null;
  modelBaseUrlInput: HTMLInputElement | null;
  modelNameInput: HTMLInputElement | null;
  modelUrlInput: HTMLInputElement | null;
  mathModeSelect: HTMLSelectElement | null;
  temperatureSelect: HTMLSelectElement | null;
  topPSelect: HTMLSelectElement | null;
  timeoutSelect: HTMLSelectElement | null;
  maxRetriesSelect: HTMLSelectElement | null;
  reasoningEffortSelect: HTMLSelectElement | null;
  translationModeSelect: HTMLSelectElement | null;
  workersSelect: HTMLSelectElement | null;
  contextModeSelect: HTMLSelectElement | null;
  glossaryModeSelect: HTMLSelectElement | null;
  customRulesInput: HTMLTextAreaElement | null;
  tokenInputs: Record<string, HTMLInputElement | null | undefined>;
  optionInputs: Record<string, Record<string, HTMLInputElement | HTMLSelectElement | null | undefined>>;
};

export type CredentialsViewBag = {
  store: AppStore;
  handlersRef: { current: HandlersBag | null };
  tokenInputRef: (providerId: string) => (node: HTMLInputElement | null) => void;
  optionInputRef: (providerId: string, optionKey: string) => (node: HTMLInputElement | HTMLSelectElement | null) => void;
  elementsRef: CredentialsElementsRef;
  elementsPort?: unknown;
  viewPort?: unknown;
};

export type HomeCredentials = {
  feature: BrowserCredentialsFeature | undefined;
  view: CredentialsViewBag;
  dialogStore: DialogStore;
};

export type HomeSettingsHub = {
  dialogStore: DialogStore<{ tab?: string } | null>;
};

export type GlossariesViewBag = {
  store: AppStore;
  handlersRef: { current: HandlersBag | null };
  viewPort?: unknown;
};

export type HomeGlossaries = {
  feature: GlossariesFeature | undefined;
  view: GlossariesViewBag;
  dialogStore: DialogStore;
};

export type AppUpdateViewBag = {
  store: AppStore;
  viewPort?: unknown;
  handlersRef: { current: HandlersBag | null };
};

export type HomeAppUpdate = {
  feature: AppUpdateFeature | undefined;
  view: AppUpdateViewBag;
  handlersRef: AppUpdateViewBag["handlersRef"];
};

export type RecentJobActions = {
  selectJob: (jobId: string) => unknown;
  deleteJob: (jobId: string) => Promise<unknown> | unknown;
  openJobReader: (jobId: string) => unknown;
  recoverActiveJob: (items?: unknown[]) => unknown;
};

export type LibraryActions = RecentJobActions & {
  refresh: () => unknown;
  openSourceReader: LibraryController["openSourceReader"];
  translateDocument: LibraryController["translateDocument"];
  deleteDocument: LibraryController["deleteDocument"];
  /** 选择集可能是 unknown[]（view state），参数放宽 */
  deleteDocuments: (
    documentIds?: Array<string | null | undefined | unknown>,
  ) => Promise<DeleteDocumentsResult>;
  deleteCard: LibraryController["deleteCard"];
  openBookDetail: LibraryController["openBookDetail"];
  updateDocument: LibraryController["updateDocument"];
  storeOnly: LibraryController["storeOnly"];
  attachJobProgress: LibraryController["attachJobProgress"];
};

export type HomeLibrary = {
  viewPort: RecentJobsReactViewPort;
  recentJobsStore: AppStore;
  actions: LibraryActions;
};

export type HomeBookDetail = {
  dialogStore: DialogStore<LibraryCardItem | null>;
};

/** 分类/合集控制器（createCollectionsController 返回面） */
export type CollectionRecord = {
  collection_id?: string;
  name?: string;
  document_count?: number;
  parent_id?: string | null;
  sort_order?: number;
};

export type CollectionDocumentRecord = {
  document_id?: string;
  title?: string;
  [key: string]: unknown;
};

export type CollectionsListResult = {
  collections?: CollectionRecord[];
};

export type CollectionsController = {
  listCollections: () => Promise<CollectionsListResult>;
  createCollection: (payload?: { name?: string; parentId?: string }) => Promise<CollectionRecord>;
  patchCollection: (
    collectionId: string,
    payload?: { name?: string; sort_order?: number },
  ) => Promise<CollectionRecord>;
  deleteCollection: (collectionId: string) => Promise<unknown>;
  addDocuments: (
    collectionId: string,
    documentIds: Array<string | null | undefined | unknown>,
  ) => Promise<unknown>;
  removeDocument: (collectionId: string, documentId: string) => Promise<unknown>;
  listAllDocuments: () => Promise<CollectionDocumentRecord[]>;
  listCollectionDocumentIds: (collectionId: string) => Promise<string[]>;
  fetchFolderBooks: (collectionId: string) => Promise<LibraryCardItem[]>;
};

/** createStore 返回的 actions 经 BoundStoreActions 后难精确建模；消费面只认 bump */
export type CollectionsReloadSignal = {
  getSnapshot: () => { version: number };
  subscribe: (listener: (snapshot: { version: number }, meta?: unknown) => void) => () => void;
  actions: {
    bump: (...args: unknown[]) => unknown;
  };
};

export type HomeCollections = {
  controller: CollectionsController;
  dialogStore: DialogStore<CollectionRecord | null>;
  reloadSignal: CollectionsReloadSignal;
};

export type HomeArtifactDownloads = {
  busyStore: ArtifactDownloadBusyStore;
};

export type HomeStatusCard = {
  store: AppStore;
  cancelCurrentJob: () => unknown;
};

export type StatusDetailStoreActions = {
  resetOverview: () => unknown;
  resetTranslation: () => unknown;
  setOverview?: (overview: unknown) => unknown;
  setTranslation?: (translation: unknown) => unknown;
  setRerunPending?: (pending: boolean) => unknown;
};

export type StatusDetailStore = AppStore & {
  actions: StatusDetailStoreActions;
};

export type StatusDetailDialogStore = DialogStore<{ activeTab?: string } | null>;

export type StatusDetailController = {
  activateDetailTab: (name?: string) => void;
  openStatusDetailDialog: (tabName?: string) => void;
  buildDetailPageUrl: (jobId: string) => string;
  ensureOverviewData: () => Promise<unknown> | unknown;
  ensureTranslationData: () => Promise<unknown> | unknown;
  applyTranslationFilter: (...args: unknown[]) => unknown;
  changeTranslationPage: (...args: unknown[]) => unknown;
  selectTranslationItem: (...args: unknown[]) => unknown;
  replayCurrentItem: (...args: unknown[]) => unknown;
  rerunCurrentJob: () => Promise<unknown> | unknown;
  syncRerunAction: (statusText?: string) => unknown;
};

export type HomeStatusDetail = {
  store: StatusDetailStore;
  dialogStore: StatusDetailDialogStore;
  controller: StatusDetailController;
};

/** 主页阅读入口：跳转独立 reader.html（不再维护 dialogStore / iframe）。 */
export type HomeReader = {
  openReader: (jobId: string, anchor?: unknown) => unknown;
};

export type StatusAreaBag = {
  store: AppStore;
  isVisible: () => boolean;
  setVisible: (visible: boolean) => void;
  setWorkflowSections: (job?: unknown) => void;
  statusAreaPort?: unknown;
};

export type UploadDomRefs = {
  fileInput: HTMLInputElement | null;
};

export type UploadViewActions = {
  patch: (payload: Record<string, unknown>) => unknown;
};

export type WorkflowViewActions = {
  setSelectedGlossaryId: (id: string) => unknown;
};

export type WorkflowDialogRuntime = {
  bindEvents: () => () => void;
  close: () => void;
  isOpen: () => boolean;
  openFromEvent: (event?: Event) => void;
  openUpload: () => void;
  requestClose: () => void;
  requestOpenUpload: () => void;
  statePort?: DialogStatePort;
  sync?: () => void;
};

export type StatusDetailHolder = {
  store: StatusDetailStore | null;
  dialogStore: StatusDetailDialogStore | null;
};

// ── Bridge / Services ─────────────────────────────────────────────────

export type HomeBridge = {
  setText: (id: string, value?: string) => void;
  setWorkflowSections: (job?: unknown) => void;
  updateJobWarning: (status: unknown) => void;
  resetUploadProgress: () => void;
  resetUploadedFile: () => void;
  applyWorkflowMode: () => void;
  renderPageRangeSummary: () => void;
  setSubmitBusy: (busy: boolean) => void;
  setLinearProgress: () => void;
  updateActionButtons: () => void;
  resetEventsList: () => void;
  activateDetailTab: (name?: string) => void;
  submitForm: (event?: { preventDefault?: () => void } | null) => unknown;
};

export type HomeServices = {
  bridge: HomeBridge;
  dispose: () => void;
  features: HomeFeatures;
  initialize: () => void;
  ports: HomePorts;
  stores: HomeStores;
  statusArea: StatusAreaBag;
  credentials: HomeCredentials;
  settingsHub: HomeSettingsHub;
  glossaries: HomeGlossaries;
  appUpdate: HomeAppUpdate;
  library: HomeLibrary;
  bookDetail: HomeBookDetail;
  collections: HomeCollections;
  artifactDownloads: HomeArtifactDownloads;
  statusCard: HomeStatusCard;
  statusDetail: HomeStatusDetail;
  reader: HomeReader;
  /** text-store 的 selector 帮助函数（配合 useStoreSnapshot） */
  textOf: (snapshot: unknown, id: string, fallback?: unknown) => unknown;
  uploadDomRefs: UploadDomRefs;
  uploadViewActions: UploadViewActions;
  workflowViewActions: WorkflowViewActions;
  workflowDialog: WorkflowDialogRuntime;
};

/** buildHomeServices 的 views 入参 */
export type HomeServicesViews = {
  textStore: {
    store: AppStore;
    textOf: HomeServices["textOf"];
    setText?: (id: string, value?: string) => void;
  };
  uploadView: {
    store: AppStore;
    domRefs: UploadDomRefs;
    patch: (payload: Record<string, unknown>) => unknown;
  };
  workflowView: {
    store: AppStore;
    setSelectedGlossaryId: (id: string) => unknown;
  };
  statusArea: StatusAreaBag;
  workflowDialog: WorkflowDialogRuntime;
};

/** buildHomeServices 的 domains 入参 */
export type HomeServicesDomains = {
  credentials: {
    browserCredentialsFeature: BrowserCredentialsFeature;
    credentialsView: CredentialsViewBag;
    credentialsDialogStore: DialogStore;
    settingsHubDialogStore: DialogStore;
  };
  glossaries: {
    glossariesFeature: GlossariesFeature;
    glossariesView: GlossariesViewBag;
    glossariesDialogStore: DialogStore;
    appUpdateFeature: AppUpdateFeature;
    appUpdateView: AppUpdateViewBag;
  };
  appUpdate: {
    appUpdateFeature: AppUpdateFeature;
    appUpdateView: AppUpdateViewBag;
  };
  status: {
    statusCardStore: AppStore;
    statusDetailStore: StatusDetailStore;
    statusDetailDialogStore: StatusDetailDialogStore;
    statusDetailController: StatusDetailController;
    artifactDownloadBusyStore: ArtifactDownloadBusyStore;
  };
  library: {
    recentJobsViewPort: RecentJobsReactViewPort;
    recentJobsStatePort: RecentJobsStatePort;
    recentJobActions: RecentJobActions & { refresh: () => unknown };
    libraryController: LibraryController;
    bookDetailStore: DialogStore<LibraryCardItem | null>;
    collectionsController: CollectionsController;
    collectionManageDialogStore: DialogStore<CollectionRecord | null>;
    collectionsReloadSignal: CollectionsReloadSignal;
    recentJobsReaderPort: { openReader: HomeReader["openReader"] };
  };
};

export type AsyncFn = (...args: unknown[]) => Promise<unknown>;

export type CreateHomeCompositionOptions = {
  documentRef?: Document;
  fetchGlossaries?: AsyncFn;
  submitUploadRequest?: AsyncFn;
  loadPersistedDeveloperConfig?: () => Record<string, unknown>;
  loadPersistedBrowserConfig?: () => Record<string, unknown>;
  validateOcrToken?: AsyncFn | null;
  validateDeepSeekToken?: AsyncFn;
  queryDeepSeekBalance?: AsyncFn;
  checkApiConnectivity?: AsyncFn | null;
  saveDesktopConfig?: AsyncFn | null;
  initialDesktopMode?: boolean;
  fetchGlossary?: AsyncFn;
  createGlossary?: AsyncFn;
  updateGlossary?: AsyncFn;
  deleteGlossary?: AsyncFn;
  exportGlossaryCsv?: AsyncFn;
  parseGlossaryCsv?: AsyncFn;
  fetchLatestRelease?: AsyncFn;
  appUpdateCachePort?: {
    read: () => { info?: unknown; fresh?: boolean };
    write?: (info: unknown) => void;
  };
  appUpdateAutoCheckEnabled?: boolean;
};

// re-export library helpers used by consumers of HomeServices actions
export type {
  DeleteCardTarget,
  DeleteDocumentsResult,
  JobSubmissionView,
  LibraryCardItem,
  TranslateDocumentPayload,
  UpdateDocumentPayload,
};
