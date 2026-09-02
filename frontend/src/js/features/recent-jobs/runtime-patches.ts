import { isRecentJobActive } from "./card-presenter.js";
import { invalidateRecentJobImages } from "./image-refresh.js";
import { isPrimaryRecentJob } from "./pagination.js";
import { clearDocumentTombstone, isTombstoned } from "./tombstones.js";
import {
  createLibraryJobItemFromRuntime,
  mergeLibraryJobItem,
  mergeRuntimePatches,
  type LibraryJobItem,
  type StageAdapterPort,
  type StageProgress,
  type StageSnapshot,
} from "./runtime-item.js";
import {
  clampRuntimeStageKeyForJob,
  firstNonEmpty,
  isJobTerminal,
  isTerminalStatus,
  normalizeRuntimeDisplayStage,
  numberOrNull,
} from "./runtime-value-helpers.js";
import type { RecentJobsStatePort } from "./state.js";

/** Runtime job patch: library item plus optional flat progress fields from polling. */
export interface RuntimeJobPatch extends LibraryJobItem {
  progress_current?: number | null;
  progress_total?: number | null;
  progress_unit?: string | null;
  stage_snapshot?: StageSnapshot | null;
}

export interface RuntimePatchMergeOptions {
  stageAdapterPort?: StageAdapterPort;
}

export interface RecentJobsRuntimePatchesDeps {
  renderCurrentRecentJobs: (options?: { reset?: boolean }) => void;
  replaceRecentJobCard: (item: LibraryJobItem) => boolean;
  scheduleActiveRefresh?: (options?: { resetTimer?: boolean }) => void;
  stageAdapterPort?: StageAdapterPort;
  statePort: Pick<
    RecentJobsStatePort,
    "getSnapshot" | "replaceItem" | "prependItem" | "setHasMore" | "setItems"
  >;
  storeDrivenRendering?: boolean;
}

export interface RecentJobsRuntimePatches {
  apply: (items: LibraryJobItem[] | null | undefined) => LibraryJobItem[];
  applyExisting: (items: LibraryJobItem[] | null | undefined) => LibraryJobItem[];
  insert: (job: RuntimeJobPatch | LibraryJobItem) => void;
  update: (job: RuntimeJobPatch | LibraryJobItem) => void;
}

const IGNORED_SNAPSHOT_SOURCES = new Set(["legacy-stage", "canonical-empty-stage"]);
const PATCH_STAGE_KEYS = new Set(["ocr", "translate", "render", "done"]);

function normalizedPatchStage(value = "") {
  const normalized = normalizeRuntimeDisplayStage(value);
  return PATCH_STAGE_KEYS.has(normalized) ? normalized : "";
}

function trustedStageSnapshot(
  job: RuntimeJobPatch = {},
  stageAdapterPort: StageAdapterPort = {},
): StageSnapshot | null {
  const snapshot = job?.stage_snapshot && typeof job.stage_snapshot === "object"
    ? job.stage_snapshot
    : typeof stageAdapterPort.adaptJobStageSnapshot === "function"
      ? stageAdapterPort.adaptJobStageSnapshot(job)
      : null;
  const source = `${snapshot?.source || ""}`.trim();
  return snapshot && !IGNORED_SNAPSHOT_SOURCES.has(source) ? snapshot : null;
}

function stageKeyForPatch(
  job: RuntimeJobPatch = {},
  stageAdapterPort: StageAdapterPort = {},
) {
  const rawStage = normalizedPatchStage(job.display_stage)
    || normalizedPatchStage(trustedStageSnapshot(job, stageAdapterPort)?.publicStage)
    || normalizedPatchStage(trustedStageSnapshot(job, stageAdapterPort)?.stageKey);
  return clampRuntimeStageKeyForJob(rawStage, job);
}

function progressOfPatch(job: RuntimeJobPatch = {}): StageProgress {
  const progress = job?.progress && typeof job.progress === "object"
    ? job.progress
    : job?.stage_snapshot?.progress;
  return progress && typeof progress === "object" ? progress : {};
}

function sameRuntimeJobId(
  previous: RuntimeJobPatch = {},
  next: RuntimeJobPatch = {},
) {
  const previousId = `${previous.job_id || ""}`.trim();
  const nextId = `${next.job_id || ""}`.trim();
  return Boolean(previousId && nextId && previousId === nextId);
}

function shouldKeepPreviousRuntimePatch(
  previous: RuntimeJobPatch = {},
  next: RuntimeJobPatch = {},
  { stageAdapterPort = {} }: RuntimePatchMergeOptions = {},
) {
  if (!previous || !next) {
    return false;
  }
  if (isJobTerminal(next) || (isTerminalStatus(next.status) && next.status !== "succeeded")) {
    return false;
  }
  // 重试 / 再翻译会换 job_id：这是新一轮，绝不能继承旧终态（否则主页卡卡在「已翻译」不转圈）
  if (!sameRuntimeJobId(previous, next)) {
    return false;
  }
  // 同 job 终态后偶发非终态脏轮询：保留终态，避免卡片回退
  if (isJobTerminal(previous) && !isJobTerminal(next)) {
    return true;
  }
  if (`${next.status || ""}`.trim() === "queued" && isRecentJobActive(previous)) {
    return true;
  }
  const previousStage = stageKeyForPatch(previous, stageAdapterPort);
  const nextStage = stageKeyForPatch(next, stageAdapterPort);
  if (!previousStage || !nextStage || previousStage !== nextStage) {
    return false;
  }
  const previousProgress = progressOfPatch(previous);
  const nextProgress = progressOfPatch(next);
  const previousUnit = firstNonEmpty(previousProgress.unit, previous.progress_unit);
  const nextUnit = firstNonEmpty(nextProgress.unit, next.progress_unit);
  if (!previousUnit || !nextUnit || previousUnit !== nextUnit) {
    return false;
  }
  const previousTotal = numberOrNull(previousProgress.total ?? previous.progress_total);
  const nextTotal = numberOrNull(nextProgress.total ?? next.progress_total);
  if (previousTotal === null || nextTotal === null || previousTotal !== nextTotal || previousTotal <= 0) {
    return false;
  }
  const previousCurrent = numberOrNull(previousProgress.current ?? previous.progress_current);
  const nextCurrent = numberOrNull(nextProgress.current ?? next.progress_current);
  return previousCurrent !== null && nextCurrent !== null && previousCurrent > nextCurrent;
}

function identityFieldsFromPrevious(
  previous: RuntimeJobPatch = {},
  next: RuntimeJobPatch = {},
): Partial<RuntimeJobPatch> {
  // 换 job_id 时仍保留书目身份，避免轮询包缺字段时补丁丢 document_id/封面
  return {
    document_id: firstNonEmpty(next.document_id, previous.document_id) || undefined,
    title: firstNonEmpty(next.title, previous.title) || undefined,
    display_name: firstNonEmpty(next.display_name, previous.display_name, next.title, previous.title) || undefined,
    cover_url: firstNonEmpty(next.cover_url, previous.cover_url) || undefined,
    thumbnail_url: firstNonEmpty(next.thumbnail_url, previous.thumbnail_url) || undefined,
    page_count: next.page_count ?? previous.page_count,
  };
}

function mergeRuntimePatch(
  previous: RuntimeJobPatch | null = null,
  next: RuntimeJobPatch = {},
  { stageAdapterPort = {} }: RuntimePatchMergeOptions = {},
): RuntimeJobPatch {
  if (!previous) {
    return next;
  }
  // 新 job（重试）: 全量采用 next 的运行态，只继承书目身份字段
  if (!sameRuntimeJobId(previous, next)) {
    return {
      ...next,
      ...identityFieldsFromPrevious(previous, next),
    };
  }
  if (!shouldKeepPreviousRuntimePatch(previous, next, { stageAdapterPort })) {
    return {
      ...next,
      ...identityFieldsFromPrevious(previous, next),
    };
  }
  const previousProgress = progressOfPatch(previous);
  // 仅同 job_id 才可能保留旧 status（终态防回退 / active 盖过 queued）
  const previousTerminal = isJobTerminal(previous) && !isJobTerminal(next);
  const previousActiveOverQueued = `${next.status || ""}`.trim() === "queued" && isRecentJobActive(previous);
  const keepPreviousRuntimeState = previousTerminal || previousActiveOverQueued;
  const nextStageSnapshot = next.stage_snapshot && typeof next.stage_snapshot === "object"
    ? {
      ...next.stage_snapshot,
      progress: {
        ...(next.stage_snapshot.progress && typeof next.stage_snapshot.progress === "object"
          ? next.stage_snapshot.progress
          : {}),
        ...previousProgress,
      },
    }
    : null;
  return {
    ...next,
    ...identityFieldsFromPrevious(previous, next),
    ...(keepPreviousRuntimeState
      ? {
        status: previous.status,
        display_stage: previous.display_stage ?? next.display_stage,
        stage: previous.stage ?? next.stage,
        substage: previous.substage ?? next.substage,
        lane: previous.lane ?? next.lane,
        stage_detail: previous.stage_detail ?? next.stage_detail,
      }
      : {}),
    stage_snapshot: keepPreviousRuntimeState ? previous.stage_snapshot || next.stage_snapshot : nextStageSnapshot || next.stage_snapshot,
    progress: {
      ...(next.progress && typeof next.progress === "object" ? next.progress : {}),
      ...previousProgress,
    },
    progress_current: previousProgress.current ?? previous.progress_current ?? next.progress_current,
    progress_total: previousProgress.total ?? previous.progress_total ?? next.progress_total,
    progress_unit: previousProgress.unit ?? previous.progress_unit ?? next.progress_unit,
  };
}

export function createRecentJobsRuntimePatches({
  renderCurrentRecentJobs,
  replaceRecentJobCard,
  scheduleActiveRefresh,
  stageAdapterPort,
  statePort,
  storeDrivenRendering = false,
}: RecentJobsRuntimePatchesDeps): RecentJobsRuntimePatches {
  const runtimeJobPatches = new Map<string, RuntimeJobPatch>();
  const runtimeCreatedJobIds = new Set<string>();

  function apply(items: LibraryJobItem[] | null | undefined) {
    // 先把 patches 按 document_id 并进列表项（重试换 job_id 时不丢原卡）
    const mergedItems = mergeRuntimePatches(items, runtimeJobPatches, { stageAdapterPort });
    const presentJobIds = new Set(
      mergedItems
        .map((item) => `${item?.job_id || ""}`.trim())
        .filter(Boolean),
    );
    const presentDocumentIds = new Set(
      mergedItems
        .map((item) => `${item?.document_id || ""}`.trim())
        .filter(Boolean),
    );
    // 仅「全新文档」才 prepend；同一 document 已在列表里绝不再插第二张。
    // 带 source_job_id 的是阶段重试血缘，绝不能当新书插（否则主页多一张 job_id 空壳）。
    const missingCreatedItems = Array.from(runtimeCreatedJobIds)
      .filter((createdJobId: string) => {
        if (presentJobIds.has(createdJobId)) return false;
        const patch = runtimeJobPatches.get(createdJobId);
        if (!patch) return false;
        const docId = `${patch?.document_id || ""}`.trim();
        if (docId && presentDocumentIds.has(docId)) return false;
        if (`${(patch as RuntimeJobPatch)?.source_job_id || ""}`.trim()) return false;
        return true;
      })
      .map((createdJobId) => createLibraryJobItemFromRuntime(runtimeJobPatches.get(createdJobId), { stageAdapterPort }))
      .filter(Boolean);
    return [...missingCreatedItems, ...mergedItems];
  }

  function applyExisting(items: LibraryJobItem[] | null | undefined) {
    return mergeRuntimePatches(items, runtimeJobPatches, { stageAdapterPort });
  }

  function findItemIndex(
    items: LibraryJobItem[],
    job: RuntimeJobPatch | LibraryJobItem,
    jobId: string,
  ) {
    const byJob = items.findIndex((item) => `${item?.job_id || ""}`.trim() === jobId);
    if (byJob >= 0) return byJob;
    // 阶段重试会换新 job_id：用 source_job_id / document_id / active_job_id 找回原书卡片
    const sourceJobId = `${(job as RuntimeJobPatch)?.source_job_id || ""}`.trim();
    if (sourceJobId) {
      const bySource = items.findIndex((item) => {
        const itemJob = `${item?.job_id || ""}`.trim();
        const itemActive = `${item?.active_job_id || ""}`.trim();
        return itemJob === sourceJobId || itemActive === sourceJobId;
      });
      if (bySource >= 0) return bySource;
    }
    const documentId = `${job?.document_id || ""}`.trim();
    if (documentId) {
      const byDoc = items.findIndex((item) => `${item?.document_id || ""}`.trim() === documentId);
      if (byDoc >= 0) return byDoc;
    }
    return -1;
  }

  /** 补丁必须带上原卡书目身份，否则终态 refresh 会把「换 id 的重试」当成新建空壳卡 prepend */
  function stampBookIdentity(
    patch: RuntimeJobPatch,
    previousItem: LibraryJobItem | null | undefined,
    job: RuntimeJobPatch | LibraryJobItem,
  ): RuntimeJobPatch {
    const prev = previousItem || {};
    const currentJobId = firstNonEmpty(patch.job_id, job.job_id);
    // source_job_id 仅表示「重试前的旧 job」；不可写成当前 id 自己
    const rawSource = firstNonEmpty(
      (patch as RuntimeJobPatch).source_job_id,
      (job as RuntimeJobPatch).source_job_id,
      // 仅当就地换 id 时才把旧 job_id 记作 source
      (prev.job_id && currentJobId && prev.job_id !== currentJobId ? prev.job_id : ""),
    );
    const sourceJobId = rawSource && rawSource !== currentJobId ? rawSource : undefined;
    return {
      ...patch,
      document_id: firstNonEmpty(patch.document_id, job.document_id, prev.document_id) || undefined,
      title: firstNonEmpty(patch.title, job.title, prev.title) || undefined,
      display_name: firstNonEmpty(patch.display_name, job.display_name, prev.display_name, prev.title) || undefined,
      cover_url: firstNonEmpty(patch.cover_url, job.cover_url, prev.cover_url) || undefined,
      thumbnail_url: firstNonEmpty(patch.thumbnail_url, job.thumbnail_url, prev.thumbnail_url) || undefined,
      page_count: patch.page_count ?? job.page_count ?? prev.page_count,
      source_job_id: sourceJobId,
    };
  }

  function update(job: RuntimeJobPatch | LibraryJobItem) {
    const jobId = `${job?.job_id || ""}`.trim();
    if (!jobId) {
      return;
    }
    // 墓碑:已删除条目不被轮询补丁复活(后端投影/删除竞态期间仍可能拉到旧 payload)
    if (isTombstoned(job)) {
      return;
    }
    const state = statePort.getSnapshot();
    const index = findItemIndex(state.items, job, jobId);
    const previousJobId = index >= 0
      ? `${state.items[index]?.job_id || ""}`.trim()
      : "";
    const previousItem = index >= 0 ? state.items[index] : null;
    // 补丁 map：重试换 id 时把旧 patch 并过来；再盖上原卡书目身份
    const previousPatch = previousJobId && previousJobId !== jobId
      ? runtimeJobPatches.get(previousJobId)
      : runtimeJobPatches.get(jobId);
    const merged = mergeRuntimePatch(previousPatch || previousItem, job, { stageAdapterPort });
    const patch = stampBookIdentity(merged, previousItem, job);
    runtimeJobPatches.set(jobId, patch);
    if (previousJobId && previousJobId !== jobId) {
      runtimeJobPatches.delete(previousJobId);
      runtimeCreatedJobIds.delete(previousJobId);
      // 就地改原卡：绝不能标成 created，否则 soft refresh 会 prepend 一张 job_id 空壳
    }
    if (index < 0) {
      // 仍找不到原卡时：若带 document_id 但补丁缺书名，不要 insert 空壳
      // （否则主页会出现「转圈 + job_id」占位卡，原书还在）
      const title = `${patch.title || patch.display_name || ""}`.trim();
      const hasBookIdentity = Boolean(
        `${patch.document_id || ""}`.trim()
        && title
        && !/^mock-/i.test(title)
        && title !== jobId
        && title !== `${jobId}.pdf`,
      );
      if (isRecentJobActive(patch) && hasBookIdentity) {
        insert(patch);
      }
      return;
    }
    const nextItem = mergeLibraryJobItem(previousItem || {}, {
      ...patch,
      job_id: jobId,
      source_job_id: undefined,
      library_only: false,
      active_job_id: jobId,
      document_id: firstNonEmpty(patch.document_id, previousItem?.document_id),
    }, { stageAdapterPort });
    // 再写回补丁，保证 refresh 合并时有 document_id/真书名
    runtimeJobPatches.set(jobId, stampBookIdentity(patch, nextItem, job));
    invalidateRecentJobImages(previousItem || {}, nextItem);
    // job_id 变更时 replaceItem 按新 id 匹配会失败，必须整表替换该行
    if (previousJobId && previousJobId !== jobId && typeof statePort.setItems === "function") {
      const nextItems = state.items.map((item, i) => (i === index ? nextItem : item));
      statePort.setItems(nextItems);
    } else {
      statePort.replaceItem(nextItem);
    }
    if (!storeDrivenRendering && !replaceRecentJobCard(nextItem)) {
      renderCurrentRecentJobs({ reset: true });
    }
    scheduleActiveRefresh?.({ resetTimer: false });
  }

  function insert(job: RuntimeJobPatch | LibraryJobItem) {
    if (!isPrimaryRecentJob(job)) {
      return;
    }
    const jobId = `${job?.job_id || ""}`.trim();
    if (!jobId) {
      return;
    }
    // 新任务创建:同 document 的墓碑解除(重新上传同一文档要能正常显示)
    clearDocumentTombstone(`${job?.document_id || ""}`);
    // 已删除的任务条目不会被旧轮询重新插入
    if (isTombstoned(job)) {
      return;
    }
    // 核心：有 document_id / source_job_id 且书架已有该书 → 就地 update，绝不 prepend 新卡
    const state = statePort.getSnapshot();
    const existingIndex = findItemIndex(state.items, job, jobId);
    if (existingIndex >= 0) {
      const previousJobId = `${state.items[existingIndex]?.job_id || ""}`.trim();
      update({
        ...job,
        source_job_id: `${(job as RuntimeJobPatch)?.source_job_id || previousJobId || ""}`.trim() || undefined,
        document_id: job.document_id || state.items[existingIndex]?.document_id,
      });
      return;
    }
    // 馆藏合成 id `doc:<documentId>`：按 document 再找一次
    const documentId = `${job?.document_id || ""}`.trim();
    if (documentId) {
      const syntheticId = `doc:${documentId}`;
      const bySynthetic = state.items.findIndex(
        (item) => `${item?.job_id || ""}`.trim() === syntheticId
          || `${item?.document_id || ""}`.trim() === documentId,
      );
      if (bySynthetic >= 0) {
        update({
          ...job,
          source_job_id: `${state.items[bySynthetic]?.job_id || ""}`.trim() || undefined,
          document_id: documentId,
        });
        return;
      }
    }

    const nextItem = createLibraryJobItemFromRuntime(job, { stageAdapterPort });
    if (!nextItem) {
      return;
    }
    runtimeJobPatches.set(nextItem.job_id, job);
    runtimeCreatedJobIds.add(nextItem.job_id);
    statePort.prependItem(nextItem);
    statePort.setHasMore(state.hasMore);
    if (!storeDrivenRendering) {
      renderCurrentRecentJobs({ reset: true });
    }
    scheduleActiveRefresh?.({ resetTimer: false });
  }

  return {
    apply,
    applyExisting,
    insert,
    update,
  };
}
