import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureDeepSeekBudgetReady,
} from "../src/js/features/app-actions/submit-flow.js";

// withTimeout 依赖 window.setTimeout/clearTimeout；Node 测试环境补最小 stub
if (!globalThis.window) {
  globalThis.window = { setTimeout, clearTimeout };
}

function createBudgetPort(budget) {
  return () => budget;
}

test("ensureDeepSeekBudgetReady allows custom provider with unsupported balance query", async () => {
  const messages = [];
  const allowed = await ensureDeepSeekBudgetReady({
    workflow: "book",
    workflowNeedsUpload: () => true,
    currentBudgetState: createBudgetPort({
      visible: true,
      blocking: false,
      balanceChecked: false,
      balanceUnsupported: true,
    }),
    refreshDeepSeekBalance: async () => ({
      ok: false,
      status: "unsupported_provider",
      summary: "余额查询仅支持 DeepSeek 官方 API",
    }),
    setText: (id, text) => messages.push([id, text]),
  });

  assert.equal(allowed, true);
});

test("ensureDeepSeekBudgetReady allows custom provider via state flag without refresh status", async () => {
  // refresh 未显式返回 unsupported_provider（如旧 stub），但状态层已标记
  // 自定义服务商：同样放行，余额交由用户自行判断。
  const allowed = await ensureDeepSeekBudgetReady({
    workflow: "book",
    workflowNeedsUpload: () => true,
    currentBudgetState: createBudgetPort({
      visible: true,
      blocking: false,
      balanceChecked: false,
      balanceUnsupported: true,
    }),
    refreshDeepSeekBalance: async () => ({ ok: true, status: "available" }),
    setText: () => {},
  });

  assert.equal(allowed, true);
});

test("ensureDeepSeekBudgetReady blocks official DeepSeek until balance is checked", async () => {
  const messages = [];
  const allowed = await ensureDeepSeekBudgetReady({
    workflow: "book",
    workflowNeedsUpload: () => true,
    currentBudgetState: createBudgetPort({
      visible: true,
      blocking: false,
      balanceChecked: false,
      balanceUnsupported: false,
    }),
    refreshDeepSeekBalance: async () => ({ ok: true, status: "available" }),
    setText: (id, text) => messages.push([id, text]),
  });

  assert.equal(allowed, false);
  assert.deepEqual(messages.at(-1), ["error-box", "无法确认 DeepSeek 余额，请先在接口设置中完成检测。"]);
});

test("ensureDeepSeekBudgetReady still blocks when checked balance is insufficient", async () => {
  const messages = [];
  const allowed = await ensureDeepSeekBudgetReady({
    workflow: "book",
    workflowNeedsUpload: () => true,
    currentBudgetState: createBudgetPort({
      visible: true,
      blocking: true,
      balanceChecked: true,
      balanceUnsupported: false,
      message: "预计 ¥8.79 · 533 页 · 余额 ¥1.00",
    }),
    refreshDeepSeekBalance: async () => ({ ok: true, status: "available" }),
    setText: (id, text) => messages.push([id, text]),
  });

  assert.equal(allowed, false);
  assert.deepEqual(messages.at(-1), ["error-box", "余额不足：预计 ¥8.79 · 533 页 · 余额 ¥1.00。请充值后再提交。"]);
});

test("ensureDeepSeekBudgetReady skips check when workflow needs no upload", async () => {
  let refreshCalled = false;
  const allowed = await ensureDeepSeekBudgetReady({
    workflow: "render",
    workflowNeedsUpload: () => false,
    currentBudgetState: createBudgetPort({ visible: false }),
    refreshDeepSeekBalance: async () => {
      refreshCalled = true;
      return null;
    },
    setText: () => {},
  });

  assert.equal(allowed, true);
  assert.equal(refreshCalled, false);
});
