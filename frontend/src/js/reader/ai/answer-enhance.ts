// AI 回答 DOM 增强：注入 [n] 可点引用、精简脚注、鉴权图片 blob 化。

import { fetchProtected } from "../../api/http.js";
import { resolveResourceUrl } from "../../job/artifacts.js";
import {
  isReaderAiNavigationLocked,
  shouldIgnoreReaderAiNavEvent,
} from "./ui-interaction-lock.js";

export type AiCitationLike = {
  ref?: number | string;
  block_id?: string;
  page_idx?: number;
  page?: number;
  job_id?: string;
  document_id?: string;
  snippet?: string;
  [key: string]: unknown;
};

export function isAgenticCitation(citation: unknown): citation is AiCitationLike {
  return !!citation
    && typeof citation === "object"
    && `${(citation as AiCitationLike).block_id || ""}`.trim() !== "";
}

/** 从 citation 解析 0 基 page_idx；缺省时尝试 block_id 里的 p00N。 */
export function resolveCitationPageIdx(citation: AiCitationLike | null | undefined): number | null {
  if (!citation || typeof citation !== "object") return null;
  // page_idx 全链 0 基（Python Citation/新 ask 链路）
  const rawIdx = citation.page_idx;
  if (rawIdx !== undefined && rawIdx !== null && `${rawIdx}`.trim() !== "") {
    const n = Number(rawIdx);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  // page 字段系统内全部 1 基（旧 /reader/ai/chat 链路、Python _public_anchor）
  // ——此前被当 0 基直用，只带 page 的数据会差一页（审计 B4 latent off-by-one）
  const rawPage = citation.page;
  if (rawPage !== undefined && rawPage !== null && `${rawPage}`.trim() !== "") {
    const n = Number(rawPage);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n) - 1;
  }
  // p009-b0010 → page 9 (1-based) → idx 8
  const match = `${citation.block_id || ""}`.match(/(?:^|[^0-9])p0*([1-9]\d*)(?:-|_|\b)/i);
  if (match) {
    const oneBased = Number(match[1]);
    if (Number.isFinite(oneBased) && oneBased >= 1) return oneBased - 1;
  }
  return null;
}

/** 阅读器 1 基页码 */
export function resolveCitationPageNumber(citation: AiCitationLike | null | undefined): number | null {
  const idx = resolveCitationPageIdx(citation);
  if (idx === null) return null;
  return idx + 1;
}

export function clipSnippet(text = "", maxLength = 72): string {
  const normalized = `${text}`.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}…`;
}

/** 只保留回答正文出现的 [n]，避免「甩 10 条长列表」。 */
export function pickCitationsForAnswer(
  answerText: string,
  citations: AiCitationLike[],
  { max = 5 }: { max?: number } = {},
): AiCitationLike[] {
  const agentic = citations.filter(isAgenticCitation).map((c) => ({
    ...c,
    page_idx: resolveCitationPageIdx(c) ?? c.page_idx,
  }));
  if (!agentic.length) return [];

  const byRef = new Map<string, AiCitationLike>();
  for (const c of agentic) {
    byRef.set(`${c.ref}`, c);
  }

  const orderedRefs: string[] = [];
  const seen = new Set<string>();
  for (const match of `${answerText || ""}`.matchAll(/\[(\d+)\]/g)) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    if (!byRef.has(ref)) continue;
    seen.add(ref);
    orderedRefs.push(ref);
  }

  if (orderedRefs.length) {
    return orderedRefs.slice(0, max).map((ref) => byRef.get(ref)!);
  }

  // 正文未标 [n] 时只留少量高质量锚点（按页去重）
  const fallback: AiCitationLike[] = [];
  const pages = new Set<number>();
  for (const c of agentic) {
    const page = resolveCitationPageIdx(c);
    if (page !== null) {
      if (pages.has(page)) continue;
      pages.add(page);
    }
    fallback.push(c);
    if (fallback.length >= Math.min(3, max)) break;
  }
  return fallback;
}

export function buildPagePreviewUrl(jobId: string, pageIdx0: number, kind: "translated" | "source" = "translated"): string {
  const job = `${jobId || ""}`.trim();
  const page = Math.max(1, Math.floor(Number(pageIdx0) || 0) + 1);
  if (!job) return "";
  const path = `/api/v1/jobs/${encodeURIComponent(job)}/preview/pages/${page}?kind=${kind}&width=240`;
  return resolveResourceUrl(path) || path;
}

export function buildMarkdownImageApiUrl(jobId: string, relativePath: string): string {
  const job = `${jobId || ""}`.trim();
  let rel = `${relativePath || ""}`.replace(/\\/g, "/").replace(/^\.\//, "");
  while (rel.startsWith("images/")) {
    rel = rel.slice("images/".length);
  }
  if (!job || !rel) return "";
  const path = `/api/v1/jobs/${encodeURIComponent(job)}/markdown/images/${rel.split("/").map(encodeURIComponent).join("/")}`;
  return resolveResourceUrl(path) || path;
}

/**
 * 把 markdown 生成的 <a href> 改成无导航 span。
 * 桌面端 Electron setWindowOpenHandler → shell.openExternal：
 * 任何 target=_blank / window.open / 真实 <a> 点击都会弹出系统浏览器。
 * 分支 remount 时幽灵点击因此被体感成「重新打开新标签」。
 */
export function neutralizeMarkdownAnchors(
  container: ParentNode,
  {
    onOpen,
    documentRef = globalThis.document,
  }: {
    /** 用户主动点链接时回调；返回 true 表示已处理 */
    onOpen?: ((href: string, event: MouseEvent) => boolean | void) | null;
    documentRef?: Document;
  } = {},
): void {
  if (!container || !documentRef) return;
  const anchors = [...((container as Element).querySelectorAll?.("a[href]") || [])];
  for (const anchor of anchors) {
    const a = anchor as HTMLAnchorElement;
    const href = `${a.getAttribute("href") || ""}`.trim();
    const span = documentRef.createElement("span");
    span.className = `aui-md-extlink${a.className ? ` ${a.className}` : ""}`.trim();
    // 保留子节点（链接里可能有 strong/code）
    while (a.firstChild) {
      span.appendChild(a.firstChild);
    }
    if (!span.textContent?.trim() && href) {
      span.textContent = href;
    }

    if (
      href
      && !href.startsWith("#")
      && !/^\s*javascript:/i.test(href)
    ) {
      span.dataset.href = href;
      span.setAttribute("role", "link");
      span.tabIndex = 0;
      span.title = `打开链接：${href}`;
      const tryOpen = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (shouldIgnoreReaderAiNavEvent(event)) return;
        if (isReaderAiNavigationLocked()) return;
        if (event instanceof MouseEvent) {
          // 仅主按钮、有实际点击次数的可信点击
          if (event.button !== 0) return;
          if (event.detail === 0) return;
        }
        if (onOpen?.(href, event as MouseEvent) === true) return;
        // 默认：不自动 openExternal。需要用户明确手势时由 onOpen 处理。
        // 这里只做 no-op，避免任何「点分支却弹出浏览器」。
      };
      span.addEventListener("click", tryOpen);
      span.addEventListener("auxclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      span.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        tryOpen(event);
      });
    } else {
      // 锚点/空链：纯文本
      span.removeAttribute("role");
    }
    a.replaceWith(span);
  }

  // 双保险：若仍有残留 a[href]（动态插入），捕获阶段一律拦截导航
  const host = container as Element;
  if (host instanceof HTMLElement && !host.dataset.auiLinkGuard) {
    host.dataset.auiLinkGuard = "1";
    host.addEventListener(
      "click",
      (event) => {
        const t = event.target;
        if (!(t instanceof Element)) return;
        const a = t.closest("a[href]");
        if (!a || !host.contains(a)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }
}

/** 把正文里的 [n] 换成可点击按钮（跳过 code/pre）。 */
export function injectCitationMarkers(
  container: ParentNode,
  citationByRef: Map<string, AiCitationLike>,
  onJump: ((citation: AiCitationLike) => void) | null,
  documentRef: Document = globalThis.document,
): void {
  if (!citationByRef.size || !container) return;
  // 先清旧标记，避免重复 inject 叠多层监听
  (container as Element).querySelectorAll?.("button.reader-ai-citation-ref").forEach((btn) => {
    const parent = btn.parentNode;
    if (!parent) return;
    parent.replaceChild(documentRef.createTextNode(btn.textContent || ""), btn);
    parent.normalize?.();
  });
  // 0x4 = SHOW_TEXT；避免依赖 NodeFilter 全局（jsdom/部分环境未挂）
  const walker = documentRef.createTreeWalker?.(container as Node, 0x4) || null;
  const textNodes: Text[] = [];
  if (walker) {
    let node = walker.nextNode();
    while (node) {
      if (!(node.parentElement?.closest?.("code, pre, .reader-ai-citation-ref, button, a, .aui-msg-actions"))) {
        textNodes.push(node as Text);
      }
      node = walker.nextNode();
    }
  }
  for (const textNode of textNodes) {
    const text = `${textNode.textContent || ""}`;
    if (!/\[\d+\]/.test(text)) continue;
    const fragment = documentRef.createDocumentFragment();
    for (const part of text.split(/(\[\d+\])/)) {
      if (!part) continue;
      const marker = part.match(/^\[(\d+)\]$/);
      const citation = marker ? citationByRef.get(marker[1]) : null;
      if (citation) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "reader-ai-citation-ref";
        button.textContent = part;
        const pageNo = resolveCitationPageNumber(citation);
        button.title = pageNo
          ? `跳到第 ${pageNo} 页 · ${clipSnippet(citation.snippet || "", 60)}`
          : clipSnippet(citation.snippet || "相关片段", 60);
        if (pageNo != null) button.dataset.page = `${pageNo}`;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          // 分支/切会话 remount 期间的幽灵点击不跳页
          if (shouldIgnoreReaderAiNavEvent(event)) return;
          onJump?.(citation);
        });
        fragment.appendChild(button);
      } else {
        fragment.appendChild(documentRef.createTextNode(part));
      }
    }
    textNode.replaceWith(fragment);
  }
}

/** 回收容器内已 hydrate 的 blob URL（重渲染/卸载前调用，防泄漏——审计 P1-5）。 */
export function revokeHydratedImageUrls(container: ParentNode | null | undefined): void {
  if (!container) return;
  const images = [...((container as Element).querySelectorAll?.("img.is-hydrated") || [])];
  for (const img of images) {
    const src = (img as HTMLImageElement).src || "";
    if (src.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(src);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 受保护 API 图片 → blob（回答正文里的 md 图）。 */
export async function hydrateProtectedImages(
  container: ParentNode,
  { fetchImpl = fetchProtected }: { fetchImpl?: typeof fetchProtected } = {},
): Promise<void> {
  const images = [...(container as Element).querySelectorAll?.("img[src], img[data-ai-src]") || []];
  await Promise.allSettled(images.map(async (img) => {
    const el = img as HTMLImageElement;
    const raw = el.getAttribute("data-ai-src") || el.getAttribute("src") || "";
    if (!raw || raw.startsWith("blob:") || raw.startsWith("data:") || raw.startsWith("mock:")) {
      return;
    }
    const isApi = /\/api\/v1\//i.test(raw) || raw.startsWith("/") || !/^[a-z]+:/i.test(raw);
    if (!isApi) return;
    const url = resolveResourceUrl(raw) || raw;
    el.setAttribute("data-ai-src", url);
    try {
      const response = await fetchImpl(url);
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      // 同一 img 重复 hydrate（引用/内容变化触发重渲染）时回收旧 blob
      const previous = el.src || "";
      if (previous.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(previous);
        } catch {
          /* ignore */
        }
      }
      el.src = objectUrl;
      el.classList.add("is-hydrated");
    } catch {
      el.classList.add("is-missing");
      el.alt = el.alt || "图片暂不可用";
    }
  }));
}

/**
 * 精简引用脚注：紧凑 chip，不默认铺大图缩略图。
 * 仅展示 pick 后的条目（通常是正文 [n]）。
 */
export function renderCitationFooter(
  host: HTMLElement,
  citations: AiCitationLike[],
  {
    onJump = null,
    answerText = "",
    max = 5,
    documentRef = globalThis.document,
  }: {
    onJump?: ((citation: AiCitationLike) => void) | null;
    answerText?: string;
    max?: number;
    documentRef?: Document;
  } = {},
): void {
  host.querySelector(".reader-ai-citations")?.remove();
  const picked = pickCitationsForAnswer(answerText, citations, { max });
  if (!picked.length) return;

  const footer = documentRef.createElement("div");
  footer.className = "reader-ai-citations";
  footer.setAttribute("aria-label", "引用来源");

  const head = documentRef.createElement("div");
  head.className = "reader-ai-citations-head";
  head.textContent = "来源";
  footer.appendChild(head);

  const list = documentRef.createElement("div");
  list.className = "reader-ai-citations-list";

  for (const citation of picked) {
    const pageNo = resolveCitationPageNumber(citation);
    const pageLabel = pageNo != null ? `p.${pageNo}` : "";
    const row = documentRef.createElement("button");
    row.type = "button";
    row.className = "reader-ai-citation-item";
    if (pageNo != null) row.dataset.page = `${pageNo}`;
    row.title = pageNo != null ? `跳到第 ${pageNo} 页` : "定位来源";
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (shouldIgnoreReaderAiNavEvent(event)) return;
      onJump?.(citation);
    });

    const refEl = documentRef.createElement("span");
    refEl.className = "reader-ai-citation-refno";
    refEl.textContent = `[${citation.ref ?? "?"}]`;

    const meta = documentRef.createElement("span");
    meta.className = "reader-ai-citation-meta";
    meta.textContent = pageLabel || "—";

    const copy = documentRef.createElement("span");
    copy.className = "reader-ai-citation-copy";
    copy.textContent = clipSnippet(citation.snippet || "相关片段", 64);

    row.append(refEl, meta, copy);
    list.appendChild(row);
  }

  footer.appendChild(list);
  host.appendChild(footer);
}
