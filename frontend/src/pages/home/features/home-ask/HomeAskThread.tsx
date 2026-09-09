// 主页 AI 消息列表：轻量 markdown 预览 + 引用跳阅读器

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FlaskConical, ListTree, Loader2, Sparkles } from "lucide-react";
import {
  buildFrontendPageUrl,
  injectCitationMarkers,
  isAgenticCitation,
  neutralizeMarkdownAnchors,
  renderCitationFooter,
  renderFinalAnswerHtml,
  renderStreamingPreviewHtml,
  type AiCitationLike,
} from "../../composition/external.js";
import { navigateToReader } from "../reader/navigate-to-reader.js";
import type { HomeAskCitation, HomeAskMessage } from "./types.js";

export const HOME_ASK_SUGGESTIONS: Array<{
  prompt: string;
  label: string;
  icon: typeof BookOpen;
}> = [
  {
    prompt: "最近入库的文献里，有哪些值得优先阅读的主题？",
    label: "浏览馆藏主题",
    icon: BookOpen,
  },
  {
    prompt: "帮我对比不同文献对同一问题的主要结论。",
    label: "跨文献对比结论",
    icon: ListTree,
  },
  {
    prompt: "有哪些常用的方法或实验设计？",
    label: "梳理方法模型",
    icon: FlaskConical,
  },
  {
    prompt: "用几句话总结图书馆里一篇核心论文。",
    label: "快速总结一篇",
    icon: Sparkles,
  },
];

function openCitation(citation: HomeAskCitation) {
  const jobId = `${citation.job_id || ""}`.trim();
  if (!jobId) return;
  const pageIdx = Number.isFinite(Number(citation.page_idx))
    ? Math.max(0, Math.floor(Number(citation.page_idx)))
    : undefined;
  const blockId = `${citation.block_id || ""}`.trim();
  const params: Record<string, string | number> = { job_id: jobId };
  if (pageIdx !== undefined) params.page_idx = pageIdx;
  if (blockId) params.block_id = blockId;
  const url = buildFrontendPageUrl("./reader.html", params);
  navigateToReader(url);
}

function AssistantBody({
  message,
}: {
  message: HomeAskMessage;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const streaming = message.status === "streaming";
  const bodyText = `${message.content || ""}`;
  const citations = (message.citations || []) as AiCitationLike[];
  const [finalHtml, setFinalHtml] = useState<string | null>(null);

  const citationByRef = useMemo(() => {
    const map = new Map<string, AiCitationLike>();
    for (const c of citations) {
      if (isAgenticCitation(c)) map.set(`${c.ref}`, c);
    }
    return map;
  }, [citations]);

  const streamingHtml = useMemo(
    () => (streaming && bodyText ? renderStreamingPreviewHtml(bodyText) : ""),
    [streaming, bodyText],
  );

  useEffect(() => {
    if (streaming) {
      setFinalHtml(null);
      return;
    }
    if (!bodyText.trim()) {
      setFinalHtml("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const html = await renderFinalAnswerHtml(bodyText);
        if (!cancelled) setFinalHtml(html);
      } catch {
        if (!cancelled) setFinalHtml(renderStreamingPreviewHtml(bodyText));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streaming, bodyText]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || streaming || finalHtml == null || !finalHtml) return;
    root.innerHTML = finalHtml;
    neutralizeMarkdownAnchors(root, { onOpen: () => true });
    injectCitationMarkers(root, citationByRef, (c) => openCitation(c as HomeAskCitation));
    const bubble = root.closest(".home-ask-msg-bubble");
    if (bubble instanceof HTMLElement) {
      renderCitationFooter(bubble, citations, {
        onJump: (c) => openCitation(c as HomeAskCitation),
        answerText: bodyText,
        max: 5,
      });
    }
  }, [streaming, finalHtml, citationByRef, citations, bodyText]);

  if (streaming) {
    if (!bodyText.trim()) return null;
    return (
      <div
        className="home-ask-md home-ask-md-streaming"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: streamingHtml }}
      />
    );
  }

  if (!bodyText.trim()) return null;
  if (finalHtml == null) {
    return (
      <div
        className="home-ask-md home-ask-md-pending"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: renderStreamingPreviewHtml(bodyText) }}
      />
    );
  }
  return <div ref={rootRef} className="home-ask-md home-ask-md-final" />;
}

export type HomeAskThreadProps = {
  messages: HomeAskMessage[];
  isRunning?: boolean;
};

export function HomeAskThread({ messages, isRunning = false }: HomeAskThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const empty = messages.length === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, isRunning]);

  // 空态由 HomeAskView 的 hero 区渲染（Notion：问候 + 居中输入 + 建议）
  if (empty) {
    return null;
  }

  return (
    <div className="home-ask-thread" role="log" aria-live="polite">
      {messages.map((m) => {
        if (m.role === "user") {
          return (
            <div key={m.id} className="home-ask-msg home-ask-msg-user">
              <div className="home-ask-msg-bubble">
                <div className="home-ask-md-plain">{m.content}</div>
              </div>
            </div>
          );
        }
        const streaming = m.status === "streaming";
        const hasBody = Boolean(m.content?.trim());
        return (
          <div key={m.id} className="home-ask-msg home-ask-msg-assistant">
            {streaming && m.progress ? (
              <div className="home-ask-thinking" role="status">
                <Loader2 className="home-ask-spin" size={13} strokeWidth={2.4} aria-hidden />
                <span>{m.progress}</span>
              </div>
            ) : null}
            {streaming && !m.progress && !hasBody ? (
              <div className="home-ask-thinking" role="status">
                <Loader2 className="home-ask-spin" size={13} strokeWidth={2.4} aria-hidden />
                <span>思考中…</span>
              </div>
            ) : null}
            {hasBody || m.status === "error" ? (
              <div className={`home-ask-msg-bubble${m.status === "error" ? " is-error" : ""}`}>
                <AssistantBody message={m} />
              </div>
            ) : null}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
