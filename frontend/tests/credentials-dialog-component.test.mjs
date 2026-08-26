import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// CredentialsDialog(Phase 3 dialogs 群,蓝图 §2)组件级测试。
// 校验:契约 id、openBrowserCredentials 事件打开(含 setupMode 首次配置态)、
// OCR/DeepSeek 校验三态、保存两分支(浏览器/桌面)、隐藏 input 与
// credentialsStatePort 双向同步、SettingsHubDialog 的 #credentials-btn 触发点、
// 词表/更新两个 tab 的占位 id 契约。

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/index.html" });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "Node", "MutationObserver", "NodeFilter"]) {
  Object.defineProperty(globalThis, key, {
    value: dom.window[key] ?? dom.window,
    writable: true,
    configurable: true,
  });
}
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0);
// Radix Presence/Tabs(阶段 B 引入)在 jsdom 下需要 cancelAnimationFrame
// (TabsContent 的 mount 动画计时器清理)和 getComputedStyle(Presence 读取
// animation-name 判断退场动画是否结束)——jsdom 的 window 上有实现,只是没有
// 像 requestAnimationFrame 一样被复制到裸 global 上,这里一并补上。
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const { createRoot } = await import("react-dom/client");
const React = await import("react");
const { createHomeComposition } = await import("../src/pages/home/composition.js");
const { HomeApp } = await import("../src/pages/home/HomeApp.jsx");
const { APP_EVENTS } = await import("../src/js/contracts/app-contract.js");
const { defaultCredentialsStatePort } = await import("../src/js/features/credentials/default-state-port.js");

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

function byId(id) {
  return dom.window.document.getElementById(id);
}

function click(element) {
  // Radix Tabs 的 Trigger 激活逻辑挂在 onMouseDown(不是 onClick)上——阶段 B
  // 迁移到 Radix Tabs 后(CredentialsDialog/SettingsHubDialog 的 tab),只
  // dispatch "click" 不会触发 tab 切换。真实浏览器点击本来就是
  // mousedown→mouseup→click 全套,这里补上 mousedown 让模拟点击更贴近真实
  // 交互,而不是放宽任何断言。
  element.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

function typeInput(element, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function mockValidators(overrides = {}) {
  return {
    validateOcrToken: async (_apiPrefix, _providerId, token) => {
      if (!token) {
        return { ok: false, status: "unauthorized", summary: "缺少 token" };
      }
      if (token === "bad-token") {
        return { ok: false, status: "unauthorized", summary: "Token 无效" };
      }
      return { ok: true, status: "valid", summary: "Token 有效" };
    },
    validateDeepSeekToken: async (_apiPrefix, payload) => {
      if (!payload?.api_key) {
        return { ok: false, status: 0 };
      }
      if (payload.api_key === "bad-key") {
        return { ok: false, status: 401, summary: "DeepSeek Key 无效或已过期。" };
      }
      return { ok: true, status: 200, summary: "DeepSeek 接口连接成功。" };
    },
    queryDeepSeekBalance: async () => ({
      ok: true,
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "88.00" }],
    }),
    ...overrides,
  };
}

function createServices(overrides = {}) {
  const { validateOcrToken, validateDeepSeekToken, queryDeepSeekBalance, ...rest } = mockValidators(overrides.validators);
  return createHomeComposition({
    fetchGlossaries: async () => ({ items: [] }),
    loadPersistedDeveloperConfig: () => ({}),
    loadPersistedBrowserConfig: () => ({}),
    validateOcrToken,
    validateDeepSeekToken,
    queryDeepSeekBalance,
    ...rest,
    ...overrides,
  });
}

async function mountHome(services) {
  const host = dom.window.document.createElement("div");
  host.id = "home-root";
  dom.window.document.body.appendChild(host);
  services.initialize();
  const root = createRoot(host);
  root.render(React.createElement(HomeApp, { services }));
  await waitFor(() => byId("app-shell"), "HomeApp 首帧渲染");
  await wait(0);
  return { host, root };
}

test("CredentialsDialog：常规入口走设置 API；setupMode 仍开独立首次配置门", async () => {
  const services = createServices();
  const { host, root } = await mountHome(services);

  // 阶段 C(shadcn 改造):CredentialsDialog 换成 Radix Dialog 后不 forceMount
  // Content——对话框关闭时整个内容(含下面这批契约 id)都不挂载。
  assert.equal(byId("browser-credentials-dialog"), null, "初始未打开时不挂载");

  // 常规：openBrowserCredentials → 设置中心 API 区（唯一日常入口）
  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials));
  await waitFor(() => byId("app-settings-dialog") !== null, "常规打开设置中心");
  await waitFor(() => byId("browser-api-key") !== null, "API 区内嵌工作台");
  assert.equal(byId("browser-credentials-dialog"), null, "常规不再弹独立接口设置窗");
  assert.ok(byId("browser-credentials-save-btn"), "内嵌工作台有保存");

  services.settingsHub.dialogStore.close();
  await waitFor(() => byId("app-settings-dialog") === null, "关闭设置");

  // ---- setupMode 首次配置态:独立弹窗，tabs 隐藏,标题/保存文案切换 ----
  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials, {
    detail: { setupMode: true },
  }));
  await waitFor(() => byId("browser-credentials-dialog") !== null, "setupMode 打开独立弹窗");
  await waitFor(() => byId("browser-credentials-title")?.textContent === "首次配置", "setupMode 标题切换");

  for (const id of [
    "browser-credentials-title", "browser-credentials-close-btn", "browser-credentials-status",
    "browser-credentials-tabs", "browser-credential-tab-api", "browser-credential-tab-task",
    "browser-credentials-save-btn", "browser-paddle-token", "browser-paddle-validate-btn",
    "browser-paddle-validation", "browser-api-key", "browser-deepseek-validate-btn",
    "browser-deepseek-validation", "browser-deepseek-top-up-link", "browser-job-math-mode",
  ]) {
    assert.ok(byId(id), `契约 id 缺失：#${id}`);
  }

  assert.equal(byId("browser-credentials-save-btn").textContent, "保存并启动");
  assert.equal(byId("browser-credentials-tabs").classList.contains("hidden"), true);
  assert.equal(byId("browser-credentials-dialog").dataset.setupMode, "1");

  root.unmount();
  services.dispose();
  host.remove();
});

test("凭据入口：设置 API 区内嵌工作台；#credential-gate-action 也打开设置 API", async () => {
  const services = createServices();
  const { host, root } = await mountHome(services);

  // 设置 → API 区：CredentialsWorkbench 直接内嵌(v2 大改,门厅按钮
  // #credentials-btn 退役),不再弹 browser-credentials-dialog。
  click(byId("app-settings-btn"));
  await waitFor(() => byId("app-settings-dialog") !== null, "设置对话框打开");
  await waitFor(() => byId("browser-credentials-tabs") !== null, "API 区内嵌凭据工作台(tabs 挂载)");
  assert.ok(byId("browser-credentials-save-btn"), "内嵌工作台带保存按钮");
  assert.equal(byId("credentials-btn"), null, "门厅按钮已退役");
  assert.equal(byId("browser-credentials-dialog"), null, "设置内不再弹二层凭据对话框");

  services.settingsHub.dialogStore.close();
  await waitFor(() => byId("app-settings-dialog") === null, "关闭设置对话框");

  // 阶段 C(shadcn 改造):credential-gate-action 挂在 TranslationWorkflowDialog
  // 内部(HeroUpload 的上传引导区),该对话框换成 Radix Dialog 后不 forceMount
  // Content——需要先打开一次才会挂载(同其余阶段 C 对话框的先例)。
  services.workflowDialog.openUpload();
  await waitFor(() => byId("credential-gate-action"), "工作流对话框打开后 credential-gate-action 挂载");
  click(byId("credential-gate-action"));
  await waitFor(() => byId("app-settings-dialog") !== null, "credential-gate-action 打开设置中心");
  await waitFor(() => byId("browser-api-key") !== null, "落到 API 设置工作台");
  assert.equal(byId("browser-credentials-dialog"), null, "常规门禁不弹独立接口窗");

  root.unmount();
  services.dispose();
  host.remove();
});

test("CredentialsDialog：OCR/DeepSeek 校验三态(缺失/错误/通过)", async () => {
  const services = createServices();
  const { host, root } = await mountHome(services);

  // 校验走设置内嵌工作台（与日常入口一致）
  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials));
  await waitFor(() => byId("app-settings-dialog") !== null, "打开设置");
  await waitFor(() => byId("browser-paddle-validate-btn") !== null, "API 工作台就绪");

  // ---- OCR(paddle):缺失 → 错误 → 通过 ----
  click(byId("browser-paddle-validate-btn"));
  await waitFor(() => byId("browser-paddle-validation").title === "请先填写 Paddle Access Token。", "OCR 缺失态");
  assert.equal(byId("browser-paddle-validation").classList.contains("is-error"), true);

  typeInput(byId("browser-paddle-token"), "bad-token");
  click(byId("browser-paddle-validate-btn"));
  await waitFor(() => byId("browser-paddle-validation").title === "Token 无效", "OCR 错误态");
  assert.equal(byId("browser-paddle-validation").classList.contains("is-error"), true);

  typeInput(byId("browser-paddle-token"), "good-token");
  click(byId("browser-paddle-validate-btn"));
  await waitFor(() => byId("browser-paddle-validation").title === "Token 有效", "OCR 通过态");
  assert.equal(byId("browser-paddle-validation").classList.contains("is-valid"), true);

  // ---- DeepSeek:缺失 → 错误 → 通过(含充值提示,余额 < 2 元时才出现——
  //      mock 返回 88 元,不应显示充值链接) ----
  // 缺失态:deepseek-flow.js(kept)的 handleBrowserDeepSeekValidate 对"缺少
  // Key"分支直接 return,不写校验徽标(与 OCR 分支的语义不同,这是既有
  // 业务逻辑,不是本域重写的行为)——缺失态改由保存按钮的守卫触发验证。
  click(byId("browser-credentials-save-btn"));
  await waitFor(() => byId("browser-deepseek-validation").title === "请先填写 DeepSeek Key。", "DeepSeek 缺失态(经保存守卫触发)");
  assert.equal(byId("browser-deepseek-validation").classList.contains("is-error"), true);
  assert.notEqual(byId("app-settings-dialog"), null, "缺字段时保存应被拦截,设置对话框不关闭");

  typeInput(byId("browser-api-key"), "bad-key");
  click(byId("browser-deepseek-validate-btn"));
  await waitFor(() => byId("browser-deepseek-validation").title === "DeepSeek Key 无效或已过期。", "DeepSeek 错误态");
  assert.equal(byId("browser-deepseek-validation").classList.contains("is-error"), true);
  assert.equal(byId("browser-deepseek-top-up-link").classList.contains("hidden"), true);

  typeInput(byId("browser-api-key"), "good-key");
  click(byId("browser-deepseek-validate-btn"));
  await waitFor(() => byId("browser-deepseek-validation").classList.contains("is-valid"), "DeepSeek 通过态");
  assert.match(byId("browser-deepseek-validation").title, /余额 CNY 88\.00/);
  assert.equal(byId("browser-deepseek-top-up-link").classList.contains("hidden"), true, "余额充足不提示充值");

  root.unmount();
  services.dispose();
  host.remove();
});

test("CredentialsDialog：保存(浏览器模式)——写隐藏 input、同步 credentialsStatePort", async () => {
  const services = createServices();
  const { host, root } = await mountHome(services);


  // 阶段 C(shadcn 改造):paddle_token/api_key/ocr_provider 等隐藏 input
  // (HiddenCredentialInputs)挂在 TranslationWorkflowDialog 内部(job-form),
  // 该对话框换成 Radix Dialog 后不 forceMount Content——需要先打开一次才会
  // 挂载(同其余阶段 C 对话框的先例)。
  services.workflowDialog.openUpload();
  await waitFor(() => byId("paddle_token"), "工作流对话框打开后隐藏 input 挂载");

  // 常规保存入口：设置 → API
  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials));
  await waitFor(() => byId("app-settings-dialog") !== null, "打开设置");
  await waitFor(() => byId("browser-api-key") !== null, "API 工作台就绪");

  typeInput(byId("browser-paddle-token"), "paddle-secret");
  typeInput(byId("browser-api-key"), "deepseek-secret");

  click(byId("browser-credentials-save-btn"));
  await waitFor(
    () => defaultCredentialsStatePort.getCredentials().modelApiKey === "deepseek-secret",
    "保存后 credentialsStatePort 更新",
  );

  assert.equal(byId("paddle_token").value, "paddle-secret", "隐藏 input 桥接:paddle_token");
  assert.equal(byId("api_key").value, "deepseek-secret", "隐藏 input 桥接:api_key");
  assert.equal(byId("ocr_provider").value, "paddle");

  const credentials = defaultCredentialsStatePort.getCredentials();
  assert.equal(credentials.paddleToken, "paddle-secret");
  assert.equal(credentials.modelApiKey, "deepseek-secret");

  root.unmount();
  services.dispose();
  host.remove();
});

test("CredentialsDialog：切换 MinerU——provider 面板/选项/双 token 互不覆盖", async () => {
  const ocrValidateCalls = [];
  const services = createServices({
    validators: {
      validateOcrToken: async (_apiPrefix, providerId, token, providerOptions) => {
        ocrValidateCalls.push([providerId, token, providerOptions]);
        return { ok: true, status: "valid", summary: "Token 有效" };
      },
    },
  });
  const { host, root } = await mountHome(services);

  services.workflowDialog.openUpload();
  await waitFor(() => byId("mineru_token"), "工作流对话框打开后隐藏 input 挂载");

  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials));
  await waitFor(() => byId("app-settings-dialog") !== null, "打开设置");
  await waitFor(() => byId("browser-api-key") !== null, "API 工作台就绪");

  // 默认仍是 paddle
  const providerSelect = byId("browser-ocr-provider-select");
  assert.equal(providerSelect.value, "paddle");
  assert.equal(dom.window.document.querySelector('[data-ocr-provider-panel="paddle"]').hidden, false);
  assert.equal(dom.window.document.querySelector('[data-ocr-provider-panel="mineru"]').hidden, true);

  // paddle 选项默认值（公共端点留空 + VL-1.6 默认模型）
  assert.equal(byId("browser-paddle-option-paddleApiUrl").value, "");
  assert.equal(byId("browser-paddle-option-paddleModel").value, "PaddleOCR-VL-1.6");

  // 先保存一次 paddle token
  typeInput(byId("browser-paddle-token"), "paddle-secret");
  typeInput(byId("browser-api-key"), "deepseek-secret");
  click(byId("browser-credentials-save-btn"));
  await waitFor(
    () => defaultCredentialsStatePort.getCredentials().paddleToken === "paddle-secret",
    "paddle token 保存",
  );

  // 受控 select：原生 setter + change 事件走 React onChange → changeProvider
  const selectSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  selectSetter.call(providerSelect, "mineru");
  providerSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await waitFor(
    () => defaultCredentialsStatePort.getCredentials().ocrProvider === "mineru",
    "切换 provider 写入 store",
  );
  await waitFor(
    () => dom.window.document.querySelector('[data-ocr-provider-panel="mineru"]').hidden === false,
    "mineru 面板激活",
  );
  assert.equal(dom.window.document.querySelector('[data-ocr-provider-panel="paddle"]').hidden, true);

  // mineru 选项默认值：vlm / ch / 公式表格识别默认开启（适合本项目扫描 PDF + 行内公式）
  assert.equal(byId("browser-mineru-option-modelVersion").value, "vlm");
  assert.equal(byId("browser-mineru-option-language").value, "ch");
  assert.equal(byId("browser-mineru-option-disableFormula").checked, false);
  assert.equal(byId("browser-mineru-option-disableTable").checked, false);

  // 修改语言与公式开关
  selectSetter.call(byId("browser-mineru-option-language"), "en");
  byId("browser-mineru-option-language").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const formulaCheckbox = byId("browser-mineru-option-disableFormula");
  const checkedSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "checked").set;
  checkedSetter.call(formulaCheckbox, true);
  formulaCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  // mineru token 校验走 provider 分发
  typeInput(byId("browser-mineru-token"), "mineru-secret");
  click(byId("browser-mineru-validate-btn"));
  await waitFor(() => ocrValidateCalls.length === 1, "mineru 校验被调用");
  assert.deepEqual(ocrValidateCalls[0], [
    "mineru",
    "mineru-secret",
    {
      modelVersion: "vlm",
      language: "en",
      disableFormula: true,
      disableTable: false,
    },
  ]);

  // 保存：mineru token + 选项落盘，paddle token 不被覆盖
  click(byId("browser-credentials-save-btn"));
  await waitFor(
    () => defaultCredentialsStatePort.getCredentials().mineruToken === "mineru-secret",
    "mineru token 保存",
  );
  const credentials = defaultCredentialsStatePort.getCredentials();
  assert.equal(credentials.ocrProvider, "mineru");
  assert.equal(credentials.paddleToken, "paddle-secret", "切换 provider 不覆盖已保存的 paddle token");
  assert.equal(credentials.ocrOptions.mineru.language, "en");
  assert.equal(credentials.ocrOptions.mineru.disableFormula, true);
  assert.equal(credentials.ocrOptions.mineru.modelVersion, "vlm", "未改的选项保持默认值");
  assert.equal(credentials.ocrOptions.paddle.paddleModel, "PaddleOCR-VL-1.6", "paddle 选项保持默认值");

  // 隐藏 input 桥接：ocr_provider / mineru_token
  assert.equal(byId("ocr_provider").value, "mineru");
  assert.equal(byId("mineru_token").value, "mineru-secret");
  assert.equal(byId("paddle_token").value, "paddle-secret");

  root.unmount();
  services.dispose();
  host.remove();
});

test("CredentialsDialog：保存(桌面模式)——走 saveDesktopConfig 分支", async () => {
  const desktopCalls = [];
  const services = createServices({
    initialDesktopMode: true,
    saveDesktopConfig: async (browserConfig, afterSave) => {
      desktopCalls.push({ browserConfig });
      await afterSave?.();
      return { firstRunCompleted: true };
    },
  });
  const { host, root } = await mountHome(services);

  // 阶段 C(shadcn 改造):saveDesktopConfig 分支同样会读 HiddenCredentialInputs
  // 挂在 TranslationWorkflowDialog 内部的隐藏 input(paddle_token 等),需要先
  // 打开一次工作流对话框才会挂载。
  services.workflowDialog.openUpload();
  await waitFor(() => byId("paddle_token"), "工作流对话框打开后隐藏 input 挂载");

  dom.window.document.dispatchEvent(new dom.window.CustomEvent(APP_EVENTS.openBrowserCredentials, {
    detail: { setupMode: true },
  }));
  await waitFor(() => byId("browser-credentials-dialog") !== null, "打开对话框(setupMode)");

  typeInput(byId("browser-paddle-token"), "paddle-desktop");
  typeInput(byId("browser-api-key"), "deepseek-desktop");

  click(byId("browser-credentials-save-btn"));
  await waitFor(() => desktopCalls.length === 1, "saveDesktopConfig 被调用");
  assert.equal(desktopCalls[0].browserConfig.modelApiKey, "deepseek-desktop");
  assert.equal(desktopCalls[0].browserConfig.paddleToken, "paddle-desktop");
  assert.equal(desktopCalls[0].browserConfig.markConfigured, true, "setupMode 下应标记首次配置完成");
  await waitFor(() => byId("browser-credentials-dialog") === null, "保存成功后对话框关闭");

  root.unmount();
  services.dispose();
  host.remove();
});

test("CredentialsDialog：隐藏 input 与 credentialsStatePort 单向受控同步(蓝图风险 1)", async () => {
  // 实现调整说明(见 HiddenCredentialInputs.jsx 头注释):隐藏 input 改走
  // 受控渲染(value 直接订阅 credentialsStatePort.store),不是蓝图原计划的
  // "非受控 ref + mirrorCredentialsToHiddenInputs 双向同步"——实测证实那套
  // 组合在任何兄弟组件重渲染时都会被 React 的表单元素受控态回收逻辑悄悄清空
  // (上传进行中 HeroUpload 高频重渲染,会把刚保存的 token 冲掉),受控是唯一
  // 不会被 React 自己吃掉的写法。store 是唯一真值,DOM 是纯投影,因此这里只
  // 断言"store → 隐藏 input"单向同步,并确认"外部直接改 DOM"不会被采纳
  // (证明真值确实是 store,不是可以被绕过的 DOM)。
  const services = createServices();
  const { host, root } = await mountHome(services);

  // 阶段 C(shadcn 改造):隐藏 input 挂在 TranslationWorkflowDialog 内部
  // (job-form),该对话框换成 Radix Dialog 后不 forceMount Content——需要先
  // 打开一次才会挂载(同其余阶段 C 对话框的先例)。
  services.workflowDialog.openUpload();
  await waitFor(() => byId("paddle_token"), "工作流对话框打开后隐藏 input 挂载");

  // composition 初始化时 credentialsStatePort 已经写入过持久化配置;
  // HiddenCredentialInputs 应把当前 store 状态实时投影进隐藏 input。
  defaultCredentialsStatePort.setCredentials({
    ocrProvider: "paddle",
    paddleToken: "from-store",
    modelApiKey: "from-store-key",
  });
  await waitFor(() => byId("paddle_token").value === "from-store", "store → 隐藏 input 投影");
  assert.equal(byId("api_key").value, "from-store-key");

  // 外部直接改 DOM(模拟浏览器自动填充等非受控写入路径)不经过 store,
  // 不会被采纳为"真值"——下一次任意 credentials 变更触发的重渲染都会把
  // DOM 拉回 store 的值,证明 store 才是唯一真值,不存在"DOM 悄悄漂移、
  // 表单提交读到脏值"的风险(这正是蓝图风险 1 要防的静默失败)。
  typeInput(byId("paddle_token"), "from-dom");
  assert.equal(byId("paddle_token").value, "from-dom", "原生 setter 写入本身会生效(没有 onChange 拦截)");
  // 触发一次(哪怕内容不变的)credentials 更新,验证下一次渲染把 DOM 拉回 store
  defaultCredentialsStatePort.patchCredentials({});
  await waitFor(() => byId("paddle_token").value === "from-store", "重渲染后 DOM 被拉回 store 真值,外部写入未被采纳");
  assert.equal(defaultCredentialsStatePort.getCredentials().paddleToken, "from-store", "store 未被 DOM 写入污染");

  root.unmount();
  services.dispose();
  host.remove();
});

test("SettingsHubDialog：词表/外观/更新 tab 契约", async () => {
  const services = createServices();
  const { host, root } = await mountHome(services);

  click(byId("app-settings-btn"));
  await waitFor(() => byId("app-settings-dialog") !== null, "设置对话框打开");

  const glossaryTab = dom.window.document.querySelector('[data-settings-tab="glossary"]');
  click(glossaryTab);
  await waitFor(() => byId("glossary-btn"), "词表 tab 占位按钮存在");
  assert.equal(dom.window.document.querySelector('[data-settings-panel="glossary"]').hidden, false);

  const appearanceTab = dom.window.document.querySelector('[data-settings-tab="appearance"]');
  assert.ok(appearanceTab, "外观 tab 存在");
  click(appearanceTab);
  await waitFor(() => byId("theme-appearance-panel"), "外观面板挂载");
  assert.equal(dom.window.document.querySelector('[data-settings-panel="appearance"]').hidden, false);
  assert.ok(byId("theme-option-classic"), "经典皮肤选项");
  assert.ok(byId("theme-option-jiangnan"), "江南院落选项");
  assert.ok(byId("theme-option-seacliff"), "海岬选项");
  assert.ok(byId("theme-option-night"), "黛瓦夜色选项");

  // 切换皮肤应写入 data-theme
  click(byId("theme-option-jiangnan"));
  await waitFor(
    () => dom.window.document.documentElement.dataset.theme === "jiangnan",
    "选中江南院落后 html[data-theme=jiangnan]",
  );
  click(byId("theme-option-night"));
  await waitFor(
    () =>
      dom.window.document.documentElement.dataset.theme === "night"
      && dom.window.document.documentElement.classList.contains("theme-dark"),
    "黛瓦夜色 + theme-dark class",
  );
  click(byId("theme-option-classic"));
  await waitFor(
    () =>
      dom.window.document.documentElement.dataset.theme === "classic"
      && !dom.window.document.documentElement.classList.contains("theme-dark"),
    "切回经典并去掉 theme-dark",
  );

  const updateTab = dom.window.document.querySelector('[data-settings-tab="update"]');
  click(updateTab);
  await waitFor(() => byId("app-update-btn"), "更新 tab 占位按钮存在");
  assert.equal(dom.window.document.querySelector('[data-settings-panel="update"]').hidden, false);

  root.unmount();
  services.dispose();
  host.remove();
});
