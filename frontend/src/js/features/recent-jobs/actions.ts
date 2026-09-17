import { resolveRecoverableJobId } from "./active-job-recovery.js";
import { createRecentJobsRuntimePort } from "./job-runtime-port.js";
import { createRecentJobsReaderPort } from "./reader-port.js";
import { createRecentJobsNavigationPort } from "./navigation-port.js";
import { addJobTombstone } from "./tombstones.js";
import { friendlyLibraryDeleteError } from "../documents-library/delete-error.js";

export function createRecentJobActions({
  apiPrefix,
  deleteLibraryBook,
  startPolling,
  openReader,
  currentJobId = () => "",
  jobRuntimePort = createRecentJobsRuntimePort({
    openJob: startPolling,
    currentJobId,
  }),
  readerPort = createRecentJobsReaderPort({
    openReader,
  }),
  closeRecentJobsDialog,
  activeJobRecoveryPort,
  navigationPort = createRecentJobsNavigationPort({
    closeDialog: closeRecentJobsDialog,
    currentJobId,
    jobRuntimePort,
    readerPort,
  }),
  renderCurrentRecentJobs,
  renderRecentJobsEmpty,
  renderRecentJobsError,
  statePort,
}: any) {
  let activeJobRecoveryAttempted = false;

  function selectJob(jobId) {
    const normalizedJobId = `${jobId || ""}`.trim();
    if (!normalizedJobId) {
      renderRecentJobsError("该任务缺少 job_id，无法打开。", { reset: false });
      return;
    }
    navigationPort.openJob(normalizedJobId);
  }

  async function deleteJob(jobId) {
    const normalizedJobId = `${jobId || ""}`.trim();
    if (!normalizedJobId || !deleteLibraryBook) {
      return;
    }
    try {
      await deleteLibraryBook(apiPrefix, normalizedJobId);
    } catch (error) {
      renderRecentJobsError(friendlyLibraryDeleteError(error), { reset: false });
      return;
    }
    // 墓碑:删除成功但后端投影/轮询竞态时防止条目复活
    addJobTombstone(normalizedJobId);
    statePort.removeJobFamily(normalizedJobId);
    const nextItems = statePort.getSnapshot().items;
    if (nextItems.length === 0) {
      renderRecentJobsEmpty("暂无最近任务");
      return;
    }
    renderCurrentRecentJobs({ reset: true });
  }

  function openJobReader(jobId) {
    const normalizedJobId = `${jobId || ""}`.trim();
    if (!normalizedJobId) {
      renderRecentJobsError("该任务缺少 job_id，无法打开对照阅读。", { reset: false });
      return;
    }
    navigationPort.openReader(normalizedJobId);
  }

  function recoverActiveJob(items = []) {
    if (activeJobRecoveryAttempted) {
      return;
    }
    if (navigationPort.currentJobId()) {
      activeJobRecoveryAttempted = true;
      return;
    }
    activeJobRecoveryAttempted = true;
    const jobId = resolveRecoverableJobId(items, activeJobRecoveryPort);
    if (!jobId) {
      return;
    }
    navigationPort.recoverJob(jobId);
  }

  return {
    deleteJob,
    openJobReader,
    recoverActiveJob,
    selectJob,
  };
}
