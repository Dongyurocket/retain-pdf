import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyProgressJobMemory,
  progressAttachTarget,
  rememberProgressSuccessor,
} from "../src/pages/home/features/library/detail/progress-job.ts";
import { mergeBookDetailPayloadWithLive } from "../src/pages/home/features/library/detail/use-book-detail-live-item.ts";

test("finished resume job is not reattached to the old timed-out job", () => {
  let memory = emptyProgressJobMemory();
  memory = rememberProgressSuccessor(memory, {
    itemJobId: "job-timeout",
    cardJobId: "job-timeout",
  });
  memory = rememberProgressSuccessor(memory, {
    itemJobId: "job-timeout",
    cardJobId: "job-resumed",
  });
  assert.equal(memory.successorJobId, "job-resumed");
  assert.equal(progressAttachTarget("job-timeout", "job-resumed", memory.successorJobId), "");
  assert.equal(progressAttachTarget("job-timeout", "", memory.successorJobId), "job-resumed");
});

test("opening another book still attaches that book's job", () => {
  let memory = rememberProgressSuccessor(emptyProgressJobMemory(), {
    itemJobId: "job-timeout",
    cardJobId: "job-resumed",
  });
  memory = rememberProgressSuccessor(memory, {
    itemJobId: "job-other",
    cardJobId: "job-resumed",
  });
  assert.equal(memory.successorJobId, "");
  assert.equal(progressAttachTarget("job-other", "job-resumed", memory.successorJobId), "job-other");
});

test("library live row replaces a stale failed detail payload after resume", () => {
  const merged = mergeBookDetailPayloadWithLive(
    {
      document_id: "doc-1",
      job_id: "job-timeout",
      active_job_id: "job-timeout",
      status: "failed",
      stage_detail: "Python worker 执行超时",
      title: "NASA report",
    },
    {
      document_id: "doc-1",
      job_id: "job-resumed",
      active_job_id: "job-resumed",
      status: "succeeded",
      stage: "finished",
      stage_detail: "任务完成",
      title: "NASA report",
    },
  );
  assert.equal(merged.job_id, "job-resumed");
  assert.equal(merged.status, "succeeded");
  assert.equal(merged.title, "NASA report");
});
