import {
  clearActiveJobId,
  writeActiveJobId,
} from "./active-job-storage.js";
import {
  createJobEventsResource,
} from "./job-events-resource.js";
import { hasReadyManifestArtifact } from "../../job/artifacts.js";
import { createCurrentJobStatePort } from "./current-job-state.js";
import { createSecondaryResourceStatePort } from "./secondary-resource-cache.js";
import {
  createJobRenderContextPort,
} from "./render-context.js";
import {
  createRuntimePollingStatePort,
  JOB_POLL_INTERVAL_MS,
} from "./runtime-polling-state.js";
import {
  notifyLibraryJobUpdated,
  requestLibraryRefresh,
} from "./library-events.js";
import { createSecondaryResourceSchedulerPort } from "./secondary-resources.js";
import { returnJobRuntimeToHome } from "./runtime-reset.js";
import { createJobRuntimeShellViewPort } from "./shell-view-port.js";
import { createJobRuntimeResetStatePort } from "./reset-state-port.js";

export function mountJobRuntimeFeature({
  state,
  apiPrefix,
  buildJobDetailEndpoint,
  fetchJobPayload,
  fetchJobEvents,
  fetchJobArtifactsManifest,
  fetchJobStageActions,
  retryJobStage,
  submitJson,
  renderJob,
  renderJobSecondaryPatch,
  setText,
  setWorkflowSections,
  resetUploadProgress,
  resetUploadedFile,
  applyWorkflowMode,
  clearPageRanges,
  updateJobWarning,
  activateDetailTab,
  onReaderDialogSync,
  onReaderDialogClose,
  uploadStatePort,
  libraryEventPort,
  jobEventsResource = createJobEventsResource({ fetchJobEvents, apiPrefix }),
  pollingPort = createRuntimePollingStatePort(state),
  currentJobPort = createCurrentJobStatePort(state),
  secondaryResourcePort = createSecondaryResourceStatePort(state),
  shellViewPort = createJobRuntimeShellViewPort(),
  jobPresentationPort,
  resetStatePort = createJobRuntimeResetStatePort(state),
  renderContextPort = createJobRenderContextPort(state, { jobPresentationPort }),
  secondaryResourceSchedulerPort = createSecondaryResourceSchedulerPort({
    state,
    apiPrefix,
    fetchJobEvents,
    jobEventsResource,
    fetchJobArtifactsManifest,
    fetchJobStageActions,
    renderJobSecondaryPatch,
    notifyLibraryJobUpdated: (job) => notifyLibraryJobUpdated(job, { port: libraryEventPort }),
    pollingPort,
    currentJobPort,
    secondaryResourcePort,
    renderContextPort,
    jobPresentationPort,
  }),
}: any) {
  const normalizeJobPayload = jobPresentationPort?.normalizeJobPayload || ((value) => value || {});
  const isTerminalStatus = jobPresentationPort?.isTerminalStatus || ((status) => status === "failed" || status === "canceled");
  const isJobTerminal = jobPresentationPort?.isJobTerminal || ((value: any = {}) => isTerminalStatus(value?.status || value));
  // 当前轮询会话是否向图书馆广播进度补丁。
  // silent：不全量刷库，但 status/stage 变化仍同步（封面转圈 / 完成「已翻译」）。
  let sessionPublishLibrary = true;
  /** silent 下上次已推到书架的 status|stage，用于跳过同态重复 notify */
  let lastLibraryPublishKey = "";

  function libraryPublishKeyOf(job: any = {}) {
    const status = `${job?.status || ""}`.trim();
    const stage = `${job?.display_stage || job?.stage || ""}`.trim();
    return `${job?.job_id || ""}|${status}|${stage}`;
  }

  async function fetchJob(jobId) {
    const generation = pollingPort.beginPoll();
    if (generation === null) {
      return;
    }
    let payload;
    try {
      payload = await fetchJobPayload(jobId, apiPrefix);
    } finally {
      pollingPort.finishPoll();
    }
    if (!pollingPort.isCurrentGeneration(jobId, generation)) {
      return;
    }
    const cachedEvents = secondaryResourcePort.cachedFor("events", jobId);
    const cachedManifest = secondaryResourcePort.cachedFor("manifest", jobId);
    const cachedStageActions = secondaryResourcePort.cachedFor("stageActions", jobId);
    const renderContext = renderContextPort.applySnapshot({
      payload,
      eventsPayload: cachedEvents,
      manifestPayload: cachedManifest,
      stageActionsPayload: cachedStageActions,
    });
    // 进度主场：statusCardStore（主卡 / 详情嵌入卡共用）
    renderJob(renderContext);
    const job = normalizeJobPayload(payload);
    const terminal = isJobTerminal(job);
    const publishKey = libraryPublishKeyOf(job);
    // 全量 publish：每次 poll；silent：仅 status/stage 变化或终态（封面转圈要靠 status=running）
    if (sessionPublishLibrary || terminal || publishKey !== lastLibraryPublishKey) {
      lastLibraryPublishKey = publishKey;
      notifyLibraryJobUpdated(job, { port: libraryEventPort });
    }
    if (shellViewPort.isReaderOpen()) {
      onReaderDialogSync?.();
    }
    if (terminal) {
      requestLibraryRefresh(state, { terminal: true, port: libraryEventPort });
      clearActiveJobId(jobId);
      pollingPort.stop();
      // 仅成功任务需要等待 markdown_bundle_zip;失败/取消没有下载产物,
      // 不做无意义的后台确认。若当前缓存已 ready 也无需额外请求。
      if (
        `${job.status || ""}`.trim() === "succeeded"
        && !hasReadyManifestArtifact(cachedManifest, "markdown_bundle_zip")
      ) {
        scheduleTerminalManifestConfirmation(jobId, generation);
      }
    }
    secondaryResourceSchedulerPort.schedule({
      jobId,
      payload,
      generation,
      terminal,
    });
  }

  function scheduleTerminalManifestConfirmation(jobId, generation) {
    const confirmDelaysMs = [1200, 4200, 9000];
    const run = (index) => {
      // 用户已开始新任务(新 generation)或重启轮询:丢弃过期确认
      if (!pollingPort.isCurrentGeneration(jobId, generation)) {
        return;
      }
      // 终态分支已安排一次即时 manifest 刷新;若它已拿到产物就不重复请求。
      if (hasReadyManifestArtifact(
        secondaryResourcePort.cachedFor("manifest", jobId),
        "markdown_bundle_zip",
      )) {
        return;
      }
      void fetchJobArtifactsManifest(jobId, apiPrefix)
        .then((manifestPayload) => {
          if (!pollingPort.isCurrentGeneration(jobId, generation)) {
            return;
          }
          secondaryResourcePort.cache("manifest", jobId, manifestPayload);
          renderJobSecondaryPatch?.({
            context: renderContextPort.currentFor(jobId),
            source: "manifest",
          });
          // markdown 压缩包已就绪 → 按钮可用,不再重试;未就绪继续等到
          // 下一次确认窗口(后端打包通常几秒内收尾)。
          if (hasReadyManifestArtifact(manifestPayload, "markdown_bundle_zip")) {
            return;
          }
          attempt(index + 1);
        })
        .catch(() => {
          attempt(index + 1);
        });
    };
    function attempt(index) {
      if (index >= confirmDelaysMs.length) {
        return;
      }
      const delay = confirmDelaysMs[index];
      if (globalThis.window?.setTimeout) {
        globalThis.window.setTimeout(() => run(index), delay);
      } else {
        globalThis.setTimeout?.(() => run(index), delay);
      }
    }
    attempt(0);
  }

  /**
   * @param {string} jobId
   * @param {{
   *   silent?: boolean,
   *   publishLibrary?: boolean,
   *   showWorkflow?: boolean,
   * }} [options]
   * - silent: 详情 Tab 等嵌入进度；不抬主工作流区、不广播 create、运行中不刷库
   * - publishLibrary / showWorkflow: 默认跟随 !silent
   */
  function startPolling(
    jobId: string,
    options: {
      silent?: boolean;
      publishLibrary?: boolean;
      showWorkflow?: boolean;
      /** 首帧 payload（重试时带 fromStage 结果，避免先闪「排队」） */
      seedPayload?: Record<string, unknown> | null;
    } = {},
  ) {
    const silent = Boolean(options.silent);
    const publishLibrary = options.publishLibrary ?? !silent;
    const showWorkflow = options.showWorkflow ?? !silent;
    sessionPublishLibrary = publishLibrary;
    lastLibraryPublishKey = "";

    pollingPort.stop();
    writeActiveJobId(jobId);
    resetStatePort.resetSecondary();
    const { startedAt } = pollingPort.startJob(jobId);
    const seed = options.seedPayload && typeof options.seedPayload === "object"
      ? options.seedPayload
      : null;
    const placeholderJob = seed
      ? {
          ...seed,
          job_id: jobId,
          // 重试首帧强制 running，避免仍显示「已翻译」不转圈
          status: seed.status && seed.status !== "succeeded"
            ? seed.status
            : "running",
          library_only: false,
          created_at: seed.created_at || startedAt,
          started_at: seed.started_at || startedAt,
        }
      : {
          job_id: jobId,
          status: "queued",
          stage: "queued",
          display_stage: "ocr",
          lane: "main",
          current_stage: "queued",
          stage_detail: "正在读取任务状态...",
          created_at: startedAt,
          started_at: startedAt,
        };
    if (showWorkflow) {
      setWorkflowSections(placeholderJob);
    }
    // 始终写 statusCardStore，供主卡 / 详情嵌入卡共用 snapshot
    renderJob(renderContextPort.applySnapshot({
      payload: placeholderJob,
    }));
    // 书架：全量模式照旧；silent 也要立刻推一帧 running，封面才能转圈
    const normalizedPlaceholder = normalizeJobPayload(placeholderJob);
    if (publishLibrary) {
      libraryEventPort?.publishJobCreated?.(normalizedPlaceholder);
      requestLibraryRefresh(state, { port: libraryEventPort });
    }
    lastLibraryPublishKey = libraryPublishKeyOf(normalizedPlaceholder);
    notifyLibraryJobUpdated(normalizedPlaceholder, { port: libraryEventPort });
    fetchJob(jobId).catch((err) => {
      setText("error-box", err.message);
    });
    pollingPort.startTimer(() => {
      fetchJob(jobId).catch((err) => {
        setText("error-box", err.message);
      });
    }, JOB_POLL_INTERVAL_MS);
  }

  function returnToHome() {
    returnJobRuntimeToHome({
      state,
      onReaderDialogClose,
      setWorkflowSections,
      resetUploadProgress,
      resetUploadedFile,
      applyWorkflowMode,
      clearPageRanges,
      setText,
      updateJobWarning,
      activateDetailTab,
      uploadStatePort,
      shellViewPort,
      jobPresentationPort,
    });
  }

  async function cancelCurrentJob() {
    const jobId = currentJobPort.jobId();
    if (!jobId) {
      setText("error-box", "当前没有可取消的任务");
      return;
    }
    shellViewPort.setCancelDisabled(true);
    try {
      await submitJson(`${buildJobDetailEndpoint(jobId, apiPrefix)}/cancel`, {});
      await fetchJob(jobId);
    } catch (err) {
      setText("error-box", err.message);
    }
  }

  async function retryStage(stage, options: { jobId?: string } = {}) {
    const normalizedStage = `${stage || ""}`.trim();
    // 优先事件带的 jobId → 当前轮询 → 上次 snapshot（详情卡上点重试时可能尚未 currentJobId）
    const jobId = `${
      options.jobId
      || currentJobPort.jobId()
      || currentJobPort.snapshot?.()?.job_id
      || ""
    }`.trim();
    if (!jobId || !normalizedStage) {
      setText("error-box", "当前没有可重新执行的阶段");
      return;
    }
    try {
      setText("error-box", "-");
      // statusCard snapshot 顶层无 document_id；身份在 job / raw_response 里
      const prevSnapshot = (currentJobPort.snapshot?.() || {}) as Record<string, unknown>;
      const prevJob = (
        (prevSnapshot.job && typeof prevSnapshot.job === "object" ? prevSnapshot.job : null)
        || prevSnapshot
      ) as Record<string, unknown>;
      const prevRaw = (
        (prevJob.raw_response && typeof prevJob.raw_response === "object" ? prevJob.raw_response : null)
        || prevJob
      ) as Record<string, unknown>;
      const pickBook = (...keys: string[]) => {
        for (const key of keys) {
          for (const source of [prevSnapshot, prevJob, prevRaw]) {
            const value = `${source?.[key] ?? ""}`.trim();
            if (value) return value;
          }
        }
        return "";
      };
      const bookMeta = {
        document_id: pickBook("document_id"),
        title: pickBook("title", "display_name"),
        display_name: pickBook("display_name", "title"),
        page_count: prevSnapshot.page_count ?? prevJob.page_count ?? prevRaw.page_count,
        cover_url: pickBook("cover_url"),
        thumbnail_url: pickBook("thumbnail_url"),
      };
      const result = await retryJobStage(jobId, apiPrefix, normalizedStage, bookMeta);
      const nextJobId = `${result?.job_id || jobId}`.trim();
      if (nextJobId) {
        // 进度字段用 result；书目元数据优先 bookMeta（避免 Mock 重试标题盖掉书名）
        const seed = normalizeJobPayload({
          ...result,
          job_id: nextJobId,
          source_job_id: jobId,
          document_id: result?.document_id || bookMeta.document_id,
          title: bookMeta.title || result?.title,
          display_name: bookMeta.display_name || bookMeta.title || result?.display_name,
          cover_url: bookMeta.cover_url || result?.cover_url,
          thumbnail_url: bookMeta.thumbnail_url || result?.thumbnail_url,
          page_count: bookMeta.page_count ?? result?.page_count,
          library_only: false,
          active_job_id: nextJobId,
        });
        // 详情 Tab 内重试：silent + 首帧用 fromStage 结果；必须带 document_id/source_job_id
        startPolling(nextJobId, {
          silent: true,
          showWorkflow: false,
          publishLibrary: false,
          seedPayload: {
            ...seed,
            source_job_id: jobId,
            document_id: seed.document_id || bookMeta.document_id,
            title: seed.title || bookMeta.title,
            display_name: seed.display_name || bookMeta.display_name || bookMeta.title,
            cover_url: seed.cover_url || bookMeta.cover_url,
            thumbnail_url: seed.thumbnail_url || bookMeta.thumbnail_url,
            status: seed.status && seed.status !== "succeeded" ? seed.status : "running",
          },
        });
        // startPolling 已 notify 一帧 running，此处不必重复
      } else {
        await fetchJob(jobId);
      }
    } catch (err) {
      setText("error-box", err.message || String(err));
    }
  }

  return {
    cancelCurrentJob,
    currentJobId: () => currentJobPort.jobId(),
    fetchJob,
    retryStage,
    returnToHome,
    startPolling,
    stopPolling: () => pollingPort.stop(),
  };
}
