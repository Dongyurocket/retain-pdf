// 图书馆删除墓碑:删除成功后把 document_id / job_id 记入墓碑,
// 在后续列表加载(collectRecentJobsPage)与运行时补丁(insert/update)里过滤,
// 防止"删除已成功但后端投影/轮询竞态把条目复活"——重启前墓碑始终生效。
//
// 注意:墓碑只挡"已删除"的身份;同一文档重新上传(新的 job 创建)时会
// 自动解除对应墓碑,见 clearDocumentTombstone。

const MAX_TOMBSTONES = 600;

const documentTombstones = new Set<string>();
const jobTombstones = new Set<string>();

function evict(set: Set<string>) {
  while (set.size > MAX_TOMBSTONES) {
    const oldest = set.values().next().value;
    if (oldest === undefined) {
      break;
    }
    set.delete(oldest);
  }
}

export function addDocumentTombstone(documentId: string) {
  const id = `${documentId || ""}`.trim();
  if (!id) {
    return;
  }
  documentTombstones.add(id);
  evict(documentTombstones);
}

export function addJobTombstone(jobId: string) {
  const id = `${jobId || ""}`.trim();
  if (!id) {
    return;
  }
  jobTombstones.add(id);
  jobTombstones.add(`${id}-ocr`);
  evict(jobTombstones);
}

/** 重新上传 / 新任务创建:同 document 的墓碑解除,新条目可以正常显示。 */
export function clearDocumentTombstone(documentId: string) {
  const id = `${documentId || ""}`.trim();
  if (id) {
    documentTombstones.delete(id);
  }
}

export function isTombstoned(item: unknown) {
  if (!item || typeof item !== "object") {
    return false;
  }
  const record = item as Record<string, unknown>;
  const documentId = `${record.document_id || ""}`.trim();
  if (documentId && documentTombstones.has(documentId)) {
    return true;
  }
  const jobId = `${record.job_id || record.active_job_id || ""}`.trim();
  if (jobId && (jobTombstones.has(jobId) || jobTombstones.has(`${jobId}-ocr`))) {
    return true;
  }
  return false;
}

export function tombstoneCount() {
  return documentTombstones.size + jobTombstones.size;
}

export function resetTombstones() {
  documentTombstones.clear();
  jobTombstones.clear();
}
