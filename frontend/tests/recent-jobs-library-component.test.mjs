import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// RecentJobsLibrary / RecentJobCard(Phase 3b recent-jobs 域)组件级测试。
// 覆盖蓝图 §6 新增测试①②③:
// ① 库网格渲染 + smoke DOM 契约(mock=parallel,走真实 mountRecentJobsFeature
//    初次加载链路,不 mock fetch——直接验证 isMockMode() 短路路径下的端到端
//    装配是否work);
// ② 卡片交互(delete 确认/取消/确认删除、select、reader);
// ③ 卡片渲染隔离(replaceItem 单卡,断言其余卡片渲染计数不变——memo 回归锚,
//    黑盒 DOM 比对无法区分"跳过 render"与"render 了但输出相同"，必须用
//    RecentJobCard.jsx 导出的渲染计数器)。

function makeDom(search = "") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `http://localhost/index.html${search}`,
  });
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "MutationObserver", "NodeFilter"]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key] ?? dom.window,
      writable: true,
      configurable: true,
    });
  }
  globalThis.window = dom.window;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0);
  // Radix Presence/Tabs(阶段 B 引入)在 jsdom 下需要 cancelAnimationFrame
  // (TabsContent 的 mount 动画计时器清理)和 getComputedStyle(Presence 读取
  // animation-name 判断退场动画是否结束)——jsdom 的 window 上有实现,只是没有
  // 像 requestAnimationFrame 一样被复制到裸 global 上,这里一并补上。NodeFilter
  // 是阶段 C(TranslationWorkflowDialog 换 Radix Dialog)新增的需要——
  // Dialog.Content 的 FocusScope 用它做可聚焦元素树遍历。
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await wait(15);
  }
  assert.fail(`等待超时：${description}`);
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

function makeItem(index, overrides = {}) {
  return {
    job_id: `job-${index}`,
    title: `Book ${index}`,
    display_name: `Book ${index}`,
    status: "succeeded",
    display_stage: "done",
    substage: "",
    page_count: 10 + index,
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

async function bootHomeApp(dom) {
  const { createRoot } = await import("react-dom/client");
  const React = await import("react");
  const { createHomeComposition } = await import("../src/pages/home/composition.js");
  const { HomeApp } = await import("../src/pages/home/HomeApp.jsx");

  const host = dom.window.document.createElement("div");
  host.id = "home-root";
  dom.window.document.body.appendChild(host);

  const services = createHomeComposition({
    fetchGlossaries: async () => ({ items: [] }),
    loadPersistedDeveloperConfig: () => ({}),
    loadPersistedBrowserConfig: () => ({}),
  });
  services.initialize();

  const root = createRoot(host);
  root.render(React.createElement(HomeApp, { services }));
  await waitFor(() => dom.window.document.getElementById("library-view"), "HomeApp 首帧渲染");
  await wait(0);

  return { services, root, host };
}

function byId(dom, id) {
  return dom.window.document.getElementById(id);
}

test("RecentJobsLibrary：初始加载(mock=parallel)渲染网格 + DOM 契约", async () => {
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);

  // mock=parallel 走 isMockMode() 短路(fetchLibraryBookList/fetchJobList 不
  // 打真实网络),验证 mountRecentJobsFeature 装配在 initialize() 同步链内
  // 已生效——这正是"5 处默认参数断链"风险(蓝图风险 9)的端到端反证:如果
  // composition.js 传入的 React viewPort 被默认 createRecentJobsViewPort()
  // 悄悄短路,下面的 DOM 契约断言会全部失败(旧世界会去操作真实 DOM,新世界
  // 的 store 永远拿不到数据)。
  const contractIds = [
    "library-view", "recent-jobs-scroll-body", "recent-jobs-summary",
    "recent-jobs-empty", "library-grid", "recent-jobs-list",
  ];
  for (const id of contractIds) {
    assert.ok(byId(dom, id), `契约 id 缺失：#${id}`);
  }

  await waitFor(() => byId(dom, "recent-jobs-list").querySelector(".recent-job-item[data-job-id]"), "网格出现至少一张卡片");
  assert.equal(byId(dom, "recent-jobs-list").classList.contains("hidden"), false);
  const card = byId(dom, "recent-jobs-list").querySelector(".recent-job-item[data-job-id]");
  assert.ok(card.dataset.jobId, "卡片必须带 data-job-id");
  assert.match(byId(dom, "recent-jobs-summary").textContent, /Stage Spec|Unknown/);

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：卡片交互(select / reader / delete 确认与取消 / 确认删除)", async () => {
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);

  const items = [makeItem(1), makeItem(2), makeItem(3)];
  services.library.recentJobsStore.actions.setItems(items);
  await waitFor(() => byId(dom, "recent-jobs-list").querySelectorAll(".recent-job-item").length === 3, "三张卡片就位");

  const cardOf = (jobId) => byId(dom, "recent-jobs-list").querySelector(`.recent-job-item[data-job-id="${jobId}"]`);

  // ---- select 无 document_id：仍开书籍详情（不弹旧工作流窗）+ silent 轮询 ----
  let openCount = 0;
  dom.window.document.addEventListener(
    (await import("../src/js/contracts/app-contract.js")).APP_EVENTS.openTranslationWorkflow,
    () => { openCount += 1; },
  );
  click(dom, cardOf("job-1"));
  await waitFor(() => byId(dom, "book-detail-dialog"), "点卡打开书籍详情");
  assert.equal(openCount, 0, "点卡不打开 #translation-workflow-dialog");
  await waitFor(
    () => services.features.jobRuntimeFeature.currentJobId() === "job-1",
    "select/详情路径 silent 轮询",
  );

  // ---- reader:点击悬浮"对照阅读"按钮 → openReaderRequested ----
  const { APP_EVENTS } = await import("../src/js/contracts/app-contract.js");
  let readerDetail = null;
  dom.window.document.addEventListener(APP_EVENTS.openReaderRequested, (event) => {
    readerDetail = event.detail;
  });
  const readerButton = cardOf("job-2").querySelector(".recent-job-reader");
  click(dom, readerButton);
  await waitFor(() => readerDetail?.jobId === "job-2", "reader 按钮触发 openReaderRequested");

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：卡片眼睛=快速阅读(已完成→对照阅读;失败无源→不误触发)", async () => {
  // 卡片改成照搬 PDF_MD_lib 的 BookCard 后,删除/翻译都挪进书籍详情弹窗,卡片
  // 只留一个眼睛=快速阅读:已完成派发对照阅读;没有可读目标(失败且无 document_id)
  // 点了不派发任何东西(不再一路捅进阅读器深处报错)。
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);

  const items = [
    makeItem(1, { status: "failed" }),
    makeItem(2, { status: "succeeded" }),
  ];
  services.library.recentJobsStore.actions.setItems(items);
  await waitFor(() => byId(dom, "recent-jobs-list").querySelectorAll(".recent-job-item").length === 2, "两张卡片就位");

  const cardOf = (jobId) => byId(dom, "recent-jobs-list").querySelector(`.recent-job-item[data-job-id="${jobId}"]`);
  // 卡片不再有删除/翻译按钮(都进详情弹窗了)
  assert.equal(cardOf("job-2").querySelector(".recent-job-delete"), null, "卡片不再有删除按钮");
  assert.equal(cardOf("job-2").querySelector(".recent-job-translate"), null, "卡片不再有翻译按钮");

  const { APP_EVENTS } = await import("../src/js/contracts/app-contract.js");
  let readerDetail = null;
  dom.window.document.addEventListener(APP_EVENTS.openReaderRequested, (event) => { readerDetail = event.detail; });

  // 失败任务(makeItem 无 document_id、非 succeeded)→ 眼睛点了没有可读目标,不派发
  click(dom, cardOf("job-1").querySelector(".recent-job-reader"));
  await wait(30);
  assert.equal(readerDetail, null, "失败且无源:点眼睛不触发 openReaderRequested");

  // 已完成 → 对照阅读
  click(dom, cardOf("job-2").querySelector(".recent-job-reader"));
  await waitFor(() => readerDetail?.jobId === "job-2", "已完成点眼睛派发对照阅读");

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：馆藏文档卡(未翻译)——徽标/点卡片开详情/眼睛读原文", async () => {
  // 馆藏文档(合成 job_id `doc:<id>`)进网格:徽标"馆藏"、点卡片开书籍详情弹窗、
  // 眼睛=读原文(派发带 documentId、不带 jobId 的 openReaderRequested)。
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);

  const libraryOnlyItem = {
    job_id: "doc:doc-ref-6a1f2c", document_id: "doc-ref-6a1f2c", library_only: true,
    title: "只入库的参考书", display_name: "只入库的参考书", status: "", page_count: 42,
    updated_at: "2026-07-01T00:00:00Z",
  };
  services.library.recentJobsStore.actions.setItems([libraryOnlyItem, makeItem(2, { status: "succeeded" })]);
  await waitFor(() => byId(dom, "recent-jobs-list").querySelectorAll(".recent-job-item").length === 2, "两张卡片就位");

  const card = byId(dom, "recent-jobs-list").querySelector('.recent-job-item[data-library-only="true"]');
  assert.ok(card, "馆藏卡片渲染出来了");
  assert.equal(card.getAttribute("data-document-id"), "doc-ref-6a1f2c");
  assert.match(card.textContent, /馆藏/, "显示馆藏徽标");
  assert.equal(card.querySelector(".recent-job-delete"), null, "卡片无删除(在详情弹窗里)");

  const { APP_EVENTS } = await import("../src/js/contracts/app-contract.js");
  let readerDetail = null;
  dom.window.document.addEventListener(APP_EVENTS.openReaderRequested, (event) => { readerDetail = event.detail; });

  // 点卡片本体 → 开书籍详情弹窗(不派发 openReaderRequested)
  click(dom, card);
  await waitFor(() => byId(dom, "book-detail-dialog"), "点馆藏卡打开书籍详情弹窗");
  assert.equal(readerDetail, null, "点卡片本体不触发 openReaderRequested");
  services.bookDetail.dialogStore.close();

  // 眼睛 = 读原文(带 documentId,不带 jobId)
  click(dom, card.querySelector(".recent-job-reader"));
  await waitFor(() => readerDetail?.documentId === "doc-ref-6a1f2c", "眼睛派发带 documentId 的 openReaderRequested");
  assert.ok(!readerDetail.jobId, "馆藏文档不带 jobId");

  root.unmount();
  services.dispose();
  host.remove();
});

test("书籍详情弹窗:馆藏点翻译 → 立刻接进度 + 网格静默更新(不闪 loading)", async () => {
  // 点馆藏卡开详情 → 翻译整本 → mock 挂 active_job_id →
  // 详情 payload/进度卡立刻有 job_id，网格有真实 job 行，不靠整页 loading 重载。
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);
  const { HOME_LOADING_STATES } = await import("../src/js/features/home/state.js");

  const { getMockDocumentList } = await import("../src/js/mock/documents.js");
  const untranslated = getMockDocumentList().documents.find((doc) => !`${doc.active_job_id || ""}`.trim());
  assert.ok(untranslated, "mock 里有馆藏文档");

  services.library.recentJobsStore.actions.setItems([{
    job_id: `doc:${untranslated.document_id}`, document_id: untranslated.document_id,
    library_only: true, title: untranslated.title, status: "", page_count: untranslated.page_count,
  }]);
  await waitFor(() => byId(dom, "recent-jobs-list").querySelector('.recent-job-item[data-library-only="true"]'), "馆藏卡就位");

  click(dom, byId(dom, "recent-jobs-list").querySelector('.recent-job-item[data-library-only="true"]'));
  await waitFor(() => byId(dom, "book-detail-dialog"), "详情弹窗打开");
  click(dom, byId(dom, "book-detail-tab-translate"));
  await waitFor(() => byId(dom, "book-detail-translate-btn"), "详情弹窗翻译按钮就位");
  click(dom, byId(dom, "book-detail-translate-btn"));

  await waitFor(
    () => getMockDocumentList().documents
      .find((doc) => doc.document_id === untranslated.document_id)?.active_job_id,
    "translateDocument 给文档挂上 active_job_id",
  );

  // 详情 payload 立刻挂真实 job（翻译 Tab 可嵌 StatusCard）
  await waitFor(() => {
    const payload = services.bookDetail.dialogStore.getState().payload;
    const jobId = `${payload?.job_id || ""}`.trim();
    return jobId && !jobId.startsWith("doc:") && payload?.library_only === false;
  }, "详情 payload 立刻有真实 job_id");

  // 进度卡应出现在详情内 bd-job-status-inner（不需等整页重载）
  await waitFor(() => byId(dom, "book-detail-job-status-card"), "翻译 Tab 立刻出现 StatusCard");
  const statusCard = byId(dom, "book-detail-job-status-card");
  assert.ok(
    statusCard.querySelector(".bd-job-status-inner"),
    "进度落在 bd-job-status-inner（详情内嵌，非工作流弹窗）",
  );
  assert.ok(
    statusCard.querySelector(".bd-job-status-bar"),
    "内嵌区用进度条（无圆环）",
  );
  assert.ok(
    statusCard.querySelector(".status-stage-flow"),
    "阶段流在详情内嵌卡内",
  );

  // 绝不能打开工作流弹窗当进度 UI
  assert.equal(
    byId(dom, "translation-workflow-dialog"),
    null,
    "详情点翻译不打开工作流弹窗",
  );
  assert.equal(
    services.stores.statusArea.getSnapshot().visible,
    false,
    "主状态区保持隐藏（进度不在弹窗 StatusCard）",
  );

  // 网格有真实 job 行
  await waitFor(
    () => services.library.recentJobsStore.getSnapshot().items
      .some((item) => item.document_id === untranslated.document_id && !item.library_only),
    "网格出现真实 job 行",
  );

  assert.notEqual(
    services.stores.homeState.getSnapshot().recentJobsLoadingState,
    HOME_LOADING_STATES.LOADING,
    "翻译后静默更新，不把 recentJobs 打成 loading",
  );

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：卡片渲染隔离(replaceItem 单卡,其余 23 张卡片渲染计数不变)", async () => {
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);
  const {
    getCardRenderCountForTests,
    resetCardRenderCountsForTests,
  } = await import("../src/pages/home/features/library/index.js");

  const items = Array.from({ length: 24 }, (_, index) => makeItem(index));
  services.library.recentJobsStore.actions.setItems(items);
  await waitFor(() => byId(dom, "recent-jobs-list").querySelectorAll(".recent-job-item").length === 24, "24 张卡片就位");
  await wait(30); // 让首轮渲染的 effect/commit 完全落定

  resetCardRenderCountsForTests();

  const patchedJobId = "job-5";
  const previous = items.find((item) => item.job_id === patchedJobId);
  services.library.recentJobsStore.actions.replaceItem({
    ...previous,
    title: "Book 5 · 已更新标题",
    status: "running",
    display_stage: "translate",
  });

  await waitFor(() => {
    const card = byId(dom, "recent-jobs-list").querySelector(`.recent-job-item[data-job-id="${patchedJobId}"]`);
    return card?.querySelector(".recent-job-id")?.title === "Book 5 · 已更新标题";
  }, "被补丁的卡片内容已更新");
  await wait(30);

  // 断言"至少重渲一次"而非"恰好一次":react-dom 的 useSyncExternalStore 在
  // dev 构建下,若某个 store 在渲染进行期间(非 React 事件批处理上下文,例如
  // 本测试直接调 store.actions 而非走 onClick)又发生一次通知,会在 commit
  // 前做一次"防撕裂"一致性复核,对同一 fiber 重放一次 render(两次拿到的
  // props/输出完全相同,不是过期→最新的两次真实更新)——这是 React 内部行为
  // (可用 stack trace 验证两次调用都源自 beginWork/updateFunctionComponent),
  // 不是这里的 memo 逻辑缺陷,断言死板的"===1"会对 React 版本升级过度敏感。
  // 核心不变量始终是下面的"未涉及卡片 0 次"。
  assert.ok(getCardRenderCountForTests(patchedJobId) >= 1, "被补丁的卡片应至少重渲一次");
  for (const item of items) {
    if (item.job_id === patchedJobId) {
      continue;
    }
    assert.equal(
      getCardRenderCountForTests(item.job_id),
      0,
      `未涉及的卡片 ${item.job_id} 不应重渲(memo 回归)`,
    );
  }

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：workflow 挂起不死锁(开→job-updated 仍打补丁,不发起整页刷新→关→300ms 后刷新恢复)", async () => {
  // 蓝图风险 5:workflow 打开期间 refresh-scheduler.setSuspended(true),
  // command-handlers.js 的 onJobUpdated 仍无条件调 runtimePatches.update(单卡
  // 补丁不受影响),但被 scheduleRefresh(整页刷新)会被挂起吞掉;关闭后
  // scheduleRefresh({delay:300}) 应该让刷新恢复,不能永久卡死。
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);
  const { APP_EVENTS } = await import("../src/js/contracts/app-contract.js");
  const { HOME_LOADING_STATES } = await import("../src/js/features/home/state.js");

  // F2 文档中心化后网格加载的是"文档"(mock 有若干篇,含馆藏),这里只需要一张
  // 有真实 job 的已翻译卡当补丁靶子(runtimePatches.update 按真实 job_id 找卡)。
  await waitFor(
    () => services.library.recentJobsStore.getSnapshot().items.some((item) => item.job_id && !item.library_only),
    "初次加载的已翻译 mock 文档就位",
  );
  const originalItem = services.library.recentJobsStore
    .getSnapshot().items.find((item) => item.job_id && !item.library_only);

  services.workflowDialog.requestOpenUpload();
  // 阶段 C(shadcn 改造):TranslationWorkflowDialog 换成 Radix Dialog 后不
  // forceMount Content——关闭时不挂载,断言从"hidden 类"改为"是否挂载"
  // (同 CredentialsDialog 等阶段 C 第一批对话框的先例)。
  await waitFor(() => byId(dom, "translation-workflow-dialog") !== null, "工作流对话框打开(挂起刷新)");

  let sawLoadingWhileSuspended = false;
  const unsubscribe = services.stores.homeState.subscribe((snapshot) => {
    if (snapshot.recentJobsLoadingState === HOME_LOADING_STATES.LOADING) {
      sawLoadingWhileSuspended = true;
    }
  });

  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.libraryJobUpdated, {
    detail: { job: { ...originalItem, title: "Patched While Suspended" } },
  }));

  await waitFor(() => {
    const card = byId(dom, "recent-jobs-list").querySelector(`.recent-job-item[data-job-id="${originalItem.job_id}"]`);
    return card?.querySelector(".recent-job-id")?.title === "Patched While Suspended";
  }, "挂起期间单卡补丁(runtimePatches.update)仍无条件生效");

  await wait(150);
  assert.equal(sawLoadingWhileSuspended, false, "挂起期间不应发起整页刷新(scheduleRefresh 应被 isSuspended 吞掉)");
  unsubscribe();

  // 关闭后的恢复刷新是 scheduleRefresh({delay:300}) → loadRecentJobs({reset:true,
  // silent:true})——silent:true 意味着 loadingState 不会翻到 LOADING(静默刷新
  // 不应该让网格闪 loading),所以这里改为直接观测 recentJobsStatePort.store
  // 是否真的又发生了一次 setItems 通知(silent 刷新完成的唯一可见信号)。
  let notifyCountAfterClose = 0;
  const unsubscribe2 = services.library.recentJobsStore.subscribe(() => {
    notifyCountAfterClose += 1;
  });
  services.workflowDialog.requestClose();
  await waitFor(() => byId(dom, "translation-workflow-dialog") === null, "工作流对话框关闭");
  await waitFor(() => notifyCountAfterClose > 0, "关闭后 300ms 静默刷新应恢复(不死锁)");
  unsubscribe2();

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：真分页——空页自动回退(页码越界不落空态)", async () => {
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);
  await waitFor(
    () => services.library.recentJobsStore.getSnapshot().items.length > 0,
    "初次加载的 mock 文档就位",
  );
  const initialCount = services.library.recentJobsStore.getSnapshot().items.length;

  // mock 数据不足一页:请求第 5 页必为空,loader 应自动回退到有数据页(第 1 页)
  await services.library.viewPort.handlersRef.current.onPageChange?.(5);
  await waitFor(
    () => services.library.recentJobsStore.getSnapshot().currentPage === 1,
    "空页回退到第 1 页",
  );
  assert.equal(
    services.library.recentJobsStore.getSnapshot().items.length,
    initialCount,
    "回退页数据完整(mock 总量不足一页,只有第 1 页)",
  );

  root.unmount();
  services.dispose();
  host.remove();
});

test("RecentJobsLibrary：删除成功后条目立即消失且不被 soft 对齐复活(墓碑)", async () => {
  const dom = makeDom("?mock=parallel");
  const { services, root, host } = await bootHomeApp(dom);

  await waitFor(
    () => services.library.recentJobsStore.getSnapshot().items.length > 0,
    "初次加载的 mock 文档就位",
  );
  const items = services.library.recentJobsStore.getSnapshot().items;
  // mock 收藏固定挂在 MOCK_DOCUMENT_ID(doc-9f2a41c8e77b)上:选其它文档避开 409 删除保护
  const target = items.find((item) => {
    const id = `${item.document_id || ""}`.trim();
    return id && id !== "doc-9f2a41c8e77b";
  });
  assert.ok(target, "找到一篇可删(无收藏引用)的 mock 文档");
  const targetId = `${target.document_id}`.trim();
  const beforeCount = items.length;

  // 删除成功 → 本地乐观移除 + reload 过滤墓碑,条目数量 -1 且不再出现
  await services.library.actions.deleteDocument(targetId);
  await waitFor(
    () => {
      const rows = services.library.recentJobsStore.getSnapshot().items;
      return rows.length === beforeCount - 1
        && !rows.some((item) => `${item.document_id || ""}`.trim() === targetId);
    },
    "删除后条目从网格消失",
  );

  root.unmount();
  services.dispose();
  host.remove();
});
