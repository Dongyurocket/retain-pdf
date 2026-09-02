import { APP_EVENTS } from "../../contracts/app-contract.js";
import { bindRecentJobsCommandHandlers } from "./command-handlers.js";

export function bindRecentJobsFeatureEvents({
  apiPrefix,
  commandPort,
  doc = document,
  fetchJobPayload,
  libraryBooksResource,
  libraryRefreshPort,
  refreshScheduler,
  runtime,
  viewPort,
}: any = {}) {
  viewPort.bindEvents({
    onOpen: refreshScheduler.openDialog,
    onLoadMore: () => runtime.loadRecentJobs({ reset: false }),
    onPageChange: (page) => runtime.loadRecentJobs({ reset: true, page: Number(page) || 1 }),
    onSearch: refreshScheduler.updateSearch,
    isSuspended: refreshScheduler.isSuspended,
  });

  const commandSubscription = bindRecentJobsCommandHandlers({
    apiPrefix,
    commandPort,
    fetchJobPayload,
    libraryBooksResource,
    runtimePatches: runtime.runtimePatches,
    refreshScheduler,
  });

  const librarySubscription = libraryRefreshPort.subscribe({
    onRefreshRequested: (detail) => {
      void commandPort.requestRefresh(detail);
    },
    onJobUpdated: ({ job }: any = {}) => {
      void commandPort.publishJobUpdated(job);
    },
    onJobCreated: ({ job }: any = {}) => {
      void commandPort.publishJobCreated(job);
    },
  });

  doc.addEventListener(APP_EVENTS.statusAreaVisibilityChanged, () => {
    refreshScheduler.setSuspended(refreshScheduler.isSuspended());
  });
  doc.addEventListener(APP_EVENTS.openTranslationWorkflow, () => {
    refreshScheduler.setSuspended(true);
  });
  doc.addEventListener(APP_EVENTS.closeTranslationWorkflow, () => {
    // 打开期间 refresh 被 suspend 吞掉；关闭后必须 bypass 5s 节流做一次 soft 对齐
    refreshScheduler.setSuspended(false);
    refreshScheduler.scheduleRefresh({ delay: 300, bypassThrottle: true });
  });

  return {
    commandSubscription,
    librarySubscription,
  };
}
