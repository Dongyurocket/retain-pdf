// 详情弹窗：payload + 书架 live 行合并。
// 与 status/merge-snapshot-with-fallback 共用 isPollingBootstrapPlaceholder，
// 避免 startPolling 首帧把已完成书盖成「排队中」。

import { useMemo } from "react";
import { useStoreSnapshot } from "../../../../../shared/react/use-store.js";
import { isPollingBootstrapPlaceholder } from "../../status/merge-snapshot-with-fallback.js";

function jobIdOf(item: any = {}) {
  return `${item?.job_id || item?.active_job_id || ""}`.trim();
}

/**
 * 详情 payload 与书架 live 行合并。
 * 恢复/重试换了 job 后，live 行才是当前任务；不能再用打开弹窗时的失败 payload 盖回去。
 */
export function mergeBookDetailPayloadWithLive(payloadItem: any = {}, live: any = null) {
  if (!live) return payloadItem;

  const liveJobId = jobIdOf(live);
  const payloadJobId = jobIdOf(payloadItem);
  const liveReplacedJob = Boolean(liveJobId && payloadJobId && liveJobId !== payloadJobId);
  const payloadStatus = `${payloadItem.status || ""}`.trim();

  if (
    !liveReplacedJob
    && isPollingBootstrapPlaceholder(live)
    && (payloadStatus === "succeeded" || payloadStatus === "failed")
  ) {
    return {
      ...live,
      ...payloadItem,
      document_id: live.document_id || payloadItem.document_id,
      library_only: live.library_only ?? payloadItem.library_only,
      status: payloadStatus,
    };
  }

  if (liveReplacedJob) {
    return {
      ...payloadItem,
      ...live,
      document_id: payloadItem.document_id || live.document_id,
      job_id: liveJobId,
      active_job_id: `${live.active_job_id || liveJobId}`.trim(),
      status: `${live.status || ""}`.trim() || payloadStatus,
      stage: live.stage ?? payloadItem.stage,
      stage_detail: live.stage_detail ?? payloadItem.stage_detail,
      cover_url: live.cover_url || payloadItem.cover_url,
      thumbnail_url: live.thumbnail_url || payloadItem.thumbnail_url,
      source_pdf_url: live.source_pdf_url || payloadItem.source_pdf_url,
      artifacts: live.artifacts || payloadItem.artifacts,
      actions: live.actions || payloadItem.actions,
      links: live.links || payloadItem.links,
    };
  }

  return {
    ...live,
    ...payloadItem,
    document_id: payloadItem.document_id || live.document_id,
    job_id: payloadItem.job_id || payloadItem.active_job_id || live.job_id,
    active_job_id: payloadItem.active_job_id || payloadItem.job_id || live.active_job_id,
    cover_url: payloadItem.cover_url || live.cover_url,
    thumbnail_url: payloadItem.thumbnail_url || live.thumbnail_url,
    source_pdf_url: payloadItem.source_pdf_url || live.source_pdf_url,
    artifacts: payloadItem.artifacts || live.artifacts,
    actions: payloadItem.actions || live.actions,
    links: payloadItem.links || live.links,
  };
}

/**
 * @param {object} services useHomeServices()
 * @param {object} payloadItem dialogStore.payload
 */
export function useBookDetailLiveItem(services: any, payloadItem: any = {}) {
  const recentJobs = useStoreSnapshot(services.library.recentJobsStore);

  return useMemo(() => {
    const documentId = `${payloadItem.document_id || ""}`.trim();
    const jobId = `${payloadItem.job_id || ""}`.trim();
    const list = Array.isArray(recentJobs?.items) ? recentJobs.items : [];
    let live = null;
    if (documentId) {
      live = list.find((row) => `${row.document_id || ""}`.trim() === documentId) || null;
    }
    if (!live && jobId) {
      live = list.find((row) => `${row.job_id || ""}`.trim() === jobId) || null;
    }
    return mergeBookDetailPayloadWithLive(payloadItem, live);
  }, [payloadItem, recentJobs]);
}
