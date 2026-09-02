// LibraryPagination 组件单元测试:页码窗口/省略号/点击回调/busy 禁用。
// 真分页 UI(24 条/页)随 recent-jobs 分页改造引入,替换旧的 load-more 按钮。

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";

function makeDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/index.html",
  });
  for (const key of ["window", "document", "HTMLElement", "CustomEvent", "Event", "MouseEvent", "Node", "MutationObserver", "NodeFilter"]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key] ?? dom.window,
      writable: true,
      configurable: true,
    });
  }
  globalThis.window = dom.window;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

async function renderPagination(props) {
  const dom = makeDom();
  const { LibraryPagination } = await import(
    "../src/pages/home/features/library/page/LibraryPagination.jsx"
  );
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  const calls = [];
  root.render(React.createElement(LibraryPagination, {
    onPageChange: (page) => calls.push(page),
    ...props,
  }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const nav = () => host.querySelector(".library-pagination");
  const pageButtons = () => [...(nav()?.querySelectorAll(".library-pagination-btn:not(.library-pagination-nav)") || [])];
  const click = (element) => element?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  return {
    dom,
    host,
    root,
    calls,
    nav,
    pageButtons,
    click,
  };
}

test("LibraryPagination：一页以内不渲染", async () => {
  const { nav } = await renderPagination({ currentPage: 1, totalPages: 1 });
  assert.equal(nav(), null);
});

test("LibraryPagination：页码窗口与当前页高亮", async () => {
  const { nav, pageButtons } = await renderPagination({ currentPage: 2, totalPages: 3 });
  assert.ok(nav(), "渲染分页控件");
  const buttons = pageButtons();
  assert.deepEqual(buttons.map((b) => b.textContent), ["1", "2", "3"], "3 页 → 3 个页码");
  assert.equal(buttons[1].classList.contains("is-current"), true, "当前页高亮");
  assert.equal(buttons[1].getAttribute("aria-current"), "page");
});

test("LibraryPagination：多页省略号窗口(1 … 20)", async () => {
  const { nav, pageButtons } = await renderPagination({ currentPage: 1, totalPages: 20 });
  const buttons = pageButtons();
  const ellipsis = nav().querySelector(".library-pagination-ellipsis");
  assert.ok(ellipsis, "远端页码省略号");
  assert.deepEqual(buttons.map((b) => b.textContent), ["1", "2", "20"], "1/2/20 三个页码");
});

test("LibraryPagination：点击页码与上一页/下一页回调", async () => {
  const { nav, click, calls } = await renderPagination({ currentPage: 2, totalPages: 4 });
  const buttons = nav().querySelectorAll(".library-pagination-btn");
  // buttons: [上一页, 1, 2, 3, 4, 下一页]
  click(buttons[1]);
  click(buttons[3]);
  click(buttons[0]);
  click(buttons[5]);
  assert.deepEqual(calls, [1, 3, 1, 3], "页码点击/上一页/下一页回调正确");
});

test("LibraryPagination：边界禁用 + busy 全禁用", async () => {
  const first = await renderPagination({ currentPage: 1, totalPages: 3 });
  const navEl = first.nav();
  const buttons = navEl.querySelectorAll(".library-pagination-btn");
  assert.equal(buttons[0].disabled, true, "第 1 页禁用上一页");
  assert.equal(buttons[buttons.length - 1].disabled, false, "第 1 页可点下一页");

  const busy = await renderPagination({ currentPage: 1, totalPages: 3, busy: true });
  const busyButtons = busy.nav().querySelectorAll(".library-pagination-btn");
  assert.ok([...busyButtons].every((b) => b.disabled), "busy 时全部禁用");
});
