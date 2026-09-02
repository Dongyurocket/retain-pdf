// Markdown 悬浮预览：任务识别/译文 Markdown 产物

import { useEffect, useRef, useState, type RefObject } from "react";
import { FileCode2 } from "lucide-react";
import {
  defaultReaderDataPort,
  fetchProtected,
  parseMarkdownWithMath,
  resolveMarkdownAssetUrl,
  resolveMarkedVendorUrl,
} from "../../external.js";
import { ReaderFloatShell } from "./ReaderFloatShell.js";

export type ReaderMarkdownPanelProps = {
  open: boolean;
  jobId: string;
  sourceOnly: boolean;
  onClose: () => void;
};

let markedModulePromise: Promise<{ marked: { parse: (src: string, opts?: { async: boolean }) => string } }> | null = null;

function loadMarked() {
  if (!markedModulePromise) {
    markedModulePromise = import(/* @vite-ignore */ resolveMarkedVendorUrl()).catch((err) => {
      markedModulePromise = null;
      throw err;
    }) as typeof markedModulePromise;
  }
  return markedModulePromise!;
}

function sanitizeRenderedMarkdown(container: ParentNode) {
  container.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  container.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...(node as Element).attributes]) {
      if (/^on/i.test(attribute.name)) {
        (node as Element).removeAttribute(attribute.name);
      }
    }
  });
  container.querySelectorAll("a[href]").forEach((anchor) => {
    const el = anchor as HTMLAnchorElement;
    if (/^\s*javascript:/i.test(el.getAttribute("href") || "")) {
      el.removeAttribute("href");
    }
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  });
}

export function ReaderMarkdownPanel({
  open,
  jobId,
  sourceOnly,
  onClose,
}: ReaderMarkdownPanelProps) {
  const contentRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState("尚未加载");
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      if (sourceOnly || !jobId) {
        setStatus("源文档阅读不提供 Markdown 产物");
        if (contentRef.current) {
          contentRef.current.replaceChildren();
          contentRef.current.classList.add("hidden");
        }
        return;
      }
      setStatus("正在加载 Markdown…");
      try {
        const payload = (await defaultReaderDataPort.loadMarkdownPayload(jobId)) as Record<string, any>;
        if (cancelled) return;
        const content = `${payload?.content_with_absolute_image_urls || payload?.content || ""}`;
        const imagesBaseUrl = `${payload?.images_base_url || payload?.images_base_path || ""}`.trim();
        if (!content.trim()) {
          setStatus("该任务暂无 Markdown 产物");
          contentRef.current?.replaceChildren();
          contentRef.current?.classList.add("hidden");
          return;
        }
        const { marked } = await loadMarked();
        if (cancelled || !contentRef.current) return;
        const html = await parseMarkdownWithMath(content, (src) =>
          String(marked.parse(src, { async: false })),
        );
        if (cancelled || !contentRef.current) return;
        const template = contentRef.current.ownerDocument.createElement("template");
        template.innerHTML = html;
        sanitizeRenderedMarkdown(template.content);
        template.content.querySelectorAll("img[src]").forEach((img) => {
          // 相对 images/... 用 base 解析成 API 绝对地址，避免挂到 reader.html 同源下 404
          const raw = img.getAttribute("src") || "";
          const resolved = resolveMarkdownAssetUrl(imagesBaseUrl, raw) || raw;
          img.setAttribute("data-reader-md-src", resolved);
          img.removeAttribute("src");
        });
        contentRef.current.replaceChildren(template.content);
        contentRef.current.classList.remove("hidden");
        setStatus("");

        // 受保护图片 → 带 X-API-Key 拉 blob（<img> 无法带鉴权头）
        const images = [...contentRef.current.querySelectorAll("img[data-reader-md-src]")];
        let failed = 0;
        await Promise.allSettled(images.map(async (img) => {
          const src = img.getAttribute("data-reader-md-src") || "";
          try {
            const response = await fetchProtected(src);
            if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
            const objectUrl = URL.createObjectURL(await response.blob());
            objectUrlsRef.current.push(objectUrl);
            (img as HTMLImageElement).src = objectUrl;
          } catch {
            failed += 1;
            const fallback = img.ownerDocument.createElement("span");
            fallback.className = "reader-markdown-image-missing";
            fallback.textContent = `[图片暂不可用]`;
            fallback.title = src;
            img.replaceWith(fallback);
          }
        }));
        if (!cancelled && failed > 0 && failed === images.length && images.length > 0) {
          setStatus(`图片加载失败（${failed} 张）。请确认 API 可达且已配置 X-API-Key。`);
        }
      } catch (err) {
        if (cancelled) return;
        setStatus(err instanceof Error ? err.message : "Markdown 加载失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, sourceOnly]);

  return (
    <ReaderFloatShell
      id="reader-markdown-panel"
      open={open}
      title="Markdown"
      subtitle="识别与翻译产出 · 拖动可移动"
      titleIcon={<FileCode2 size={14} strokeWidth={2.25} aria-hidden />}
      storageKey="retainpdf.reader.markdown-float.pos.v1"
      ariaLabel="Markdown 预览"
      width={420}
      onClose={onClose}
      toolbar={(
        <span className="reader-notes-count">{status || "已加载"}</span>
      )}
    >
      {status && !contentRef.current?.childNodes?.length ? (
        <p className="reader-notes-empty">{status}</p>
      ) : null}
      <article
        ref={contentRef as RefObject<HTMLElement>}
        id="reader-markdown-content"
        className="reader-markdown-content reader-float-markdown-content"
      />
    </ReaderFloatShell>
  );
}
