import test from "node:test";
import assert from "node:assert/strict";
import { mergeRuntimePatches } from "../src/js/features/recent-jobs/runtime-item.js";
import { createRecentJobsRuntimePatches } from "../src/js/features/recent-jobs/runtime-patches.js";
import { createRecentJobsStatePort } from "../src/js/features/recent-jobs/state.js";
import { friendlyLibraryDeleteError } from "../src/js/features/documents-library/delete-error.js";
import { createRecentJobActions } from "../src/js/features/recent-jobs/actions.js";

const oldTime = "2026-09-17T09:00:00Z";
const newTime = "2026-09-17T10:00:00Z";
const base = { job_id: "refresh-job", document_id: "refresh-document", title: "Book" };
function harness(item) {
  const statePort = createRecentJobsStatePort({ recentJobsItems: [item] });
  const patches = createRecentJobsRuntimePatches({
    statePort,
    storeDrivenRendering: true,
    renderCurrentRecentJobs() {},
    replaceRecentJobCard: () => true,
  });
  return { statePort, patches };
}

test("server failure replaces an older running patch on refresh", () => {
  const server = { ...base, status: "failed", updated_at: newTime };
  const patch = { ...base, status: "running", updated_at: oldTime };
  assert.deepEqual(mergeRuntimePatches([server], new Map([[base.job_id, patch]])), [server]);
});

test("newer in-flight progress survives an older list response", () => {
  const server = { ...base, status: "running", updated_at: oldTime };
  const patch = { ...base, status: "failed", updated_at: newTime };
  assert.equal(mergeRuntimePatches([server], new Map([[base.job_id, patch]]))[0].status, "failed");
});

test("terminal server state cannot regress when timestamps are missing", () => {
  const server = { ...base, status: "failed" };
  const patch = { ...base, status: "running" };
  assert.deepEqual(mergeRuntimePatches([server], new Map([[base.job_id, patch]])), [server]);
});

test("refresh retires old patches and ignores a late running poll", () => {
  const running = { ...base, status: "running", updated_at: oldTime };
  const failed = { ...base, status: "failed", updated_at: newTime };
  const { patches, statePort } = harness(running);
  patches.insert(running);
  statePort.setItems(patches.apply([failed]));
  patches.update(running);
  assert.equal(statePort.getSnapshot().items[0].status, "failed");
  assert.deepEqual(patches.apply([]), [], "acknowledged old patch must not resurrect a missing card");
});

test("an identical server revision acknowledges an optimistic card", () => {
  const item = { ...base, status: "running", updated_at: newTime };
  const { patches, statePort } = harness(item);
  patches.insert(item);
  statePort.setItems(patches.apply([item]));
  assert.deepEqual(patches.apply([]), []);
});

test("intermediate succeeded snapshots cannot replace a terminal failure", () => {
  for (const updated_at of [undefined, newTime]) {
    const failed = { ...base, status: "failed", updated_at };
    const intermediate = { ...base, status: "succeeded", display_stage: "translate", updated_at };
    assert.deepEqual(mergeRuntimePatches([failed], new Map([[base.job_id, intermediate]])), [failed]);
  }
});

test("late terminal snapshots cannot overwrite newer terminal data", () => {
  const latest = { ...base, status: "failed", updated_at: newTime };
  const { patches, statePort } = harness(latest);
  patches.update({ ...base, status: "canceled", updated_at: oldTime });
  assert.equal(statePort.getSnapshot().items[0].status, "failed");
});

test("a retry replaces the old run but its late worker cannot take the card back", () => {
  const original = { ...base, status: "failed", created_at: oldTime, updated_at: oldTime };
  const retry = { ...base, job_id: "retry-job", source_job_id: base.job_id,
    status: "running", created_at: newTime, updated_at: newTime };
  const { patches, statePort } = harness(original);
  patches.update(retry);
  assert.equal(statePort.getSnapshot().items[0].job_id, "retry-job");
  patches.update({ ...original, updated_at: "2026-09-17T11:00:00Z" });
  assert.equal(statePort.getSnapshot().items[0].job_id, "retry-job");
  assert.equal(statePort.getSnapshot().items[0].status, "running");
});

test("refresh prefers the newer run over an old document-linked patch", () => {
  const old = { ...base, status: "failed", created_at: oldTime, updated_at: newTime };
  const latest = { ...base, job_id: "retry-on-server", status: "running",
    created_at: newTime, updated_at: newTime };
  const { patches } = harness(old);
  patches.update(old);
  assert.equal(patches.apply([latest])[0].job_id, latest.job_id);
});

test("running conflict is not classified as favorites", () => {
  const message = friendlyLibraryDeleteError({ status: 409, message: "book is Running; pass force=true to delete it(409)" });
  assert.match(message, /取消任务/);
  assert.doesNotMatch(message, /收藏|409|force/);
});

test("favorite counts are extracted from the reference, never job ids or HTTP codes", () => {
  assert.match(friendlyLibraryDeleteError({ status: 409,
    message: "job 20260917-ab is referenced by 3 favorite(s); remove the favorites first(409)" }), /有 3 条收藏/);
  assert.doesNotMatch(friendlyLibraryDeleteError({ status: 409, message: "document has favorite references(409)" }), /409 条/);
});

test("unknown conflict and server errors preserve their actual cause", () => {
  for (const status of [409, 500]) {
    assert.equal(friendlyLibraryDeleteError({ status, message: "database unavailable" }), "database unavailable");
  }
});

test("job deletion conflict never force retries or removes the card", async () => {
  const errors = [];
  let calls = 0;
  const actions = createRecentJobActions({
    navigationPort: {},
    deleteLibraryBook: async (_prefix, _id, options) => {
      calls++;
      assert.equal(options, undefined);
      throw Object.assign(new Error("book is Queued; pass force=true to delete it(409)"), { status: 409 });
    },
    renderRecentJobsError: (message) => errors.push(message),
    statePort: { removeJobFamily() { assert.fail("conflict cannot remove a card"); } },
  });
  await actions.deleteJob(base.job_id);
  assert.equal(calls, 1);
  assert.match(errors[0], /取消任务/);
});
