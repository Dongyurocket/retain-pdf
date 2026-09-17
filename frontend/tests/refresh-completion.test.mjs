import test from "node:test";
import assert from "node:assert/strict";
import { createRecentJobsLoader } from "../src/js/features/recent-jobs/loader.js";
import { createRecentJobsStatePort } from "../src/js/features/recent-jobs/state.js";

import { JSDOM } from "jsdom";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const manual = { reset: true, silent: true, preservePage: true, throwOnError: true };
function page(jobId = "fresh", total = 72) {
  return { status: "success", data: {
    collected: jobId ? [{ job_id: jobId, status: "succeeded" }] : [],
    hasMore: false, nextOffset: 72, total, latestInvocationSummary: null,
  } };
}
function setup() {
  const requests = [];
  const loadingStates = [];
  const state = createRecentJobsStatePort({
    currentPage: 3, total: 72, offset: 72,
    items: [{ job_id: "old", status: "succeeded" }],
  });
  const loader = createRecentJobsLoader({
    getQuery: () => "retained search",
    recentJobsStatePort: state,
    homeStatePort: { setRecentJobsLoadingState: (...args) => loadingStates.push(args) },
    storeDrivenRendering: true,
    runtimePatches: { apply: (items) => items },
    activeRefreshLoop: () => null,
    recentJobActions: { recoverActiveJob() {} },
    viewPort: { hasView: () => true, renderLoading() {}, setLoadMoreLoading() {} },
    libraryBooksResource: { load(params) {
      return new Promise((resolve, reject) => requests.push({ params, resolve, reject }));
    } },
  });
  return { loader, requests, state, loadingStates };
}

test("manual refresh awaits network and commits while preserving page and search", async () => {
  const { loader, requests, state } = setup();
  let completed = false;
  const completion = loader.load(manual).then(() => { completed = true; });
  await tick();
  assert.equal(completed, false);
  assert.equal(loader.isLoading(), true);
  assert.equal(state.getSnapshot().currentPage, 3);
  assert.equal(requests[0].params.startOffset, 48);
  assert.equal(requests[0].params.query, "retained search");
  requests[0].resolve(page());
  await completion;
  assert.equal(loader.isLoading(), false);
  assert.equal(state.getSnapshot().currentPage, 3);
  assert.equal(state.getSnapshot().items[0].job_id, "fresh");
});

test("queued manual refresh callers await their shared follow-up load", async () => {
  const { loader, requests } = setup();
  const first = loader.load({ ...manual, throwOnError: false });
  let completed = 0;
  const second = loader.load(manual).then(() => { completed++; });
  const third = loader.load(manual).then(() => { completed++; });
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(completed, 0);
  requests[0].resolve(page("first"));
  await first;
  assert.equal(requests.length, 2);
  assert.equal(completed, 0);
  assert.equal(loader.isLoading(), true);
  requests[1].resolve(page("second"));
  await Promise.all([second, third]);
  assert.equal(completed, 2);
  assert.equal(loader.isLoading(), false);
});

test("queued manual failure rejects only manual callers and retains existing page/items", async () => {
  const { loader, requests, state, loadingStates } = setup();
  const first = loader.load({ ...manual, throwOnError: false });
  const background = loader.load({ ...manual, throwOnError: false });
  const error = new Error("refresh unavailable");
  const failed = assert.rejects(loader.load(manual), error);
  requests[0].resolve(page("previous"));
  await first;
  requests[1].resolve({ status: "error", error });
  await Promise.all([background, failed]);
  assert.equal(state.getSnapshot().items[0].job_id, "previous");
  assert.equal(state.getSnapshot().currentPage, 3);
  assert.equal(state.getSnapshot().total, 72);
  assert.deepEqual(loadingStates.at(-1), ["error", "refresh unavailable"]);
  assert.equal(loader.isLoading(), false);
});

test("background network rejection completes safely and next manual refresh can recover", async () => {
  const { loader, requests, state } = setup();
  const background = loader.load({ ...manual, throwOnError: false });
  requests[0].reject(new Error("offline"));
  await assert.doesNotReject(background);
  const recovery = loader.load(manual);
  requests[1].resolve(page("recovered"));
  await recovery;
  assert.equal(state.getSnapshot().items[0].job_id, "recovered");
});

test("manual refresh waits for empty-page fallback without draining queued callers early", async () => {
  const { loader, requests } = setup();
  let completed = false;
  const first = loader.load(manual).then(() => { completed = true; });
  const queued = loader.load(manual);
  requests[0].resolve(page(null, 48));
  await tick();
  assert.equal(completed, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].params.startOffset, 24);
  requests[1].resolve(page("fallback", 48));
  await first;
  assert.equal(requests.length, 3);
  assert.equal(requests[2].params.startOffset, 24);
  requests[2].resolve(page("queued", 48));
  await queued;
});

test("manual action awaits loader and component reports errors with old cards visible", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost/index.html?mock=parallel",
  });
  const keys = ["window", "document", "HTMLElement", "HTMLInputElement", "CustomEvent", "Event", "MouseEvent", "Node", "MutationObserver", "NodeFilter"];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { toast } = await import("sonner");
  const { createHomeStore } = await import("../src/js/features/home/state.js");
  const { createLibraryDomain } = await import("../src/pages/home/composition/create-library-domain.js");
  const { HomeServicesProvider } = await import("../src/pages/home/home-services-context.js");
  const { RecentJobsLibrary } = await import("../src/pages/home/features/library/page/RecentJobsLibrary.jsx");
  let rejectLoad;
  const calls = [];
  const domain = createLibraryDomain({
    documentRef: dom.window.document,
    statusArea: { setVisible() {} },
    features: { recentJobsFeature: { loadRecentJobs(options) {
      calls.push(options);
      return new Promise((resolve, reject) => { rejectLoad = reject; });
    } } },
  });
  const services = {
    library: {
      actions: domain.recentJobActions,
      viewPort: domain.recentJobsViewPort,
      recentJobsStore: domain.recentJobsStatePort.store,
    },
    stores: { homeState: createHomeStore() },
  };
  services.library.recentJobsStore.actions.setItems([{ job_id: "old", title: "Old book", status: "succeeded" }]);
  const messages = [];
  const originalError = toast.error;
  toast.error = (message) => messages.push(message);
  const root = createRoot(dom.window.document.getElementById("root"));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("component did not reach expected state");
  };
  try {
    root.render(React.createElement(HomeServicesProvider, { value: services }, React.createElement(RecentJobsLibrary)));
    const button = () => dom.window.document.querySelector('[aria-label="刷新图书馆"]');
    await waitFor(button);
    button().click();
    await waitFor(() => button().disabled);
    assert.deepEqual(calls, [manual]);
    await tick();
    assert.equal(button().disabled, true);
    rejectLoad(new Error("manual network error"));
    await waitFor(() => !button().disabled);
    assert.deepEqual(messages, ["manual network error"]);
    assert.equal(dom.window.document.getElementById("recent-jobs-list").classList.contains("hidden"), false);
    assert.match(dom.window.document.getElementById("recent-jobs-list").textContent, /Old book/);
  } finally {
    root.unmount();
    toast.error = originalError;
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
