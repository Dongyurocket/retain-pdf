"""agentic 检索问答的薄循环。

刻意不用 agent 框架:单 provider(DeepSeek 兼容端点)、单用户本地
服务,裸 function calling 循环 ~200 行即可,超时/轮数/引用编号全部
自持。工具定义与主流 SDK 同构(tools.py),将来要迁移只换这层外壳。
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .config import Settings
from .tools import ToolRegistry

SYSTEM_PROMPT = """你是 RetainPDF 图书馆的文献问答助手。用户的库里是科学文献(原文多为英文,已翻译为中文)。

工作方式:
- 先用工具找证据,再回答;不要凭空回答文献内容。可以多轮使用工具、更换关键词反复检索。
- 工具结果里每条证据有 ref 编号与 page(从 1 开始的页码)。回答里只能用方括号数字引用,例如 [1] [2]。
  正确:「该方法显著降低计算量 [2]。」
  错误:「…… [p002-b0004]」「…… (block_id=…)」「…… page_idx=3」——禁止输出任何内部 ID。
- 用 Markdown 组织回答(小标题、列表、加粗);公式用 $...$ / $$...$$。
- 工具结果可能带 image_urls。若问题涉及图/表/结构式,可用:
  ![简短说明](/api/v1/jobs/.../markdown/images/...)
  只使用工具返回的 URL,不要编造。
- 找不到证据就直说没找到,不要编造。
- 用中文回答,术语保留原文。简洁、直接,不要复述工具原始 JSON。"""

CITATION_RE = re.compile(r"\[(\d+)\]")
# 模型偶发把内部 block_id 写进正文,收尾时清掉或映射成 [n]
BLOCK_ID_BRACKET_RE = re.compile(r"\[\s*(p\d+[-_]b\d+)\s*\]", re.IGNORECASE)
BLOCK_ID_BARE_RE = re.compile(r"(?<![\w/])(p\d+[-_]b\d+)(?![\w/])", re.IGNORECASE)


@dataclass
class Citation:
    ref: int
    document_id: str
    job_id: str
    page_idx: int
    block_id: str
    snippet: str


@dataclass
class AskResult:
    answer: str
    citations: list[Citation] = field(default_factory=list)
    tool_trace: list[dict[str, Any]] = field(default_factory=list)
    rounds: int = 0


ChatFn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]]


def assemble_streaming_message(
    lines: Iterable[str | bytes],
    on_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """把 DeepSeek 流式 SSE 组装成与非流式同构的 message dict。

    逐行解析 `data: {json}`(末尾 `data: [DONE]` 终止),累积 content 与按
    index 拼接的 tool_calls。只有当整轮没有出现 tool_calls(纯回答轮)时,
    才对每个 content 增量调用 on_delta——工具调用轮不 emit answer_delta。
    返回 `{"role":"assistant","content":..., "tool_calls":[...]}`,使 agent
    循环无需感知流式与否。
    """
    content_parts: list[str] = []
    tool_calls: dict[int, dict[str, Any]] = {}
    saw_tool_calls = False
    # 审计 A3：模型可能在同一轮先吐 content 前言再吐 tool_calls——立即 emit
    # 会把"让我搜索…"这类脏前言当答案流给前端（done 时又被覆盖，闪烁）。
    # 前 HOLDBACK_CHARS 个字符先缓冲定性：出现 tool_calls → 静默丢弃；
    # 攒满仍无 tool_calls → 判为纯回答轮，flush 后转直通（延迟仅数 token）。
    holdback_chars = 64
    pending: list[str] = []
    pending_flushed = False

    def _flush_pending() -> None:
        nonlocal pending_flushed
        if on_delta is not None and pending:
            on_delta("".join(pending))
        pending.clear()
        pending_flushed = True

    for raw in lines:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        line = line.strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            continue
        choices = chunk.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        delta_tool_calls = delta.get("tool_calls") or []
        if delta_tool_calls:
            if not saw_tool_calls:
                pending.clear()  # 工具轮：丢弃未定性的 content 前言，不发给前端
            saw_tool_calls = True
            for call in delta_tool_calls:
                index = call.get("index", 0)
                slot = tool_calls.setdefault(
                    index,
                    {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                )
                if call.get("id"):
                    slot["id"] = call["id"]
                if call.get("type"):
                    slot["type"] = call["type"]
                function = call.get("function") or {}
                if function.get("name"):
                    slot["function"]["name"] += function["name"]
                if function.get("arguments"):
                    slot["function"]["arguments"] += function["arguments"]
        piece = delta.get("content")
        if piece:
            content_parts.append(piece)
            if on_delta is not None and not saw_tool_calls:
                if pending_flushed:
                    on_delta(piece)
                else:
                    pending.append(piece)
                    if sum(len(p) for p in pending) >= holdback_chars:
                        _flush_pending()
    # 短纯回答（不足缓冲阈值）在流结束时补发
    if not saw_tool_calls and not pending_flushed:
        _flush_pending()
    message: dict[str, Any] = {"role": "assistant", "content": "".join(content_parts)}
    if tool_calls:
        message["tool_calls"] = [tool_calls[index] for index in sorted(tool_calls)]
    return message


def _friendly_llm_error(status_code: int, detail: str = "") -> RuntimeError:
    """把上游 LLM 的 HTTP 错误翻译成用户能行动的中文（审计 C1）。

    原样透出的 HTTPStatusError 会把内部 URL 直接糊进聊天气泡，且
    402(余额不足)/429(限流) 这类关键状态无任何指引。
    """
    hint = {
        400: "请求被模型服务拒绝（参数或上下文过长）",
        401: "模型 API Key 无效或未授权：请到 设置 → API 设置 检查 Key",
        402: "模型账户余额不足：请前往服务商充值后重试",
        403: "模型服务拒绝访问：请检查 Key 权限或所选模型",
        404: "模型或接口地址不存在：请检查模型名称与 Base URL",
        429: "模型请求过于频繁（限流）：请稍候几秒再试",
    }.get(status_code)
    if hint is None:
        if status_code >= 500:
            hint = "模型服务暂时不可用（上游故障）：请稍后重试"
        else:
            hint = f"模型服务返回错误（HTTP {status_code}）"
    snippet = f"{detail or ''}".strip().replace("\n", " ")
    if len(snippet) > 200:
        snippet = f"{snippet[:200]}…"
    return RuntimeError(f"{hint}" + (f"（上游信息：{snippet}）" if snippet else ""))


def build_deepseek_chat_fn(
    settings: Settings,
    client: httpx.Client | None = None,
    *,
    on_delta: Callable[[str], None] | None = None,
) -> ChatFn:
    http = client or httpx.Client(timeout=settings.llm_timeout_s)
    url = f"{settings.llm_base_url}/chat/completions"
    # 空 key 会变成非法 HTTP 头 `Bearer `（httpx LocalProtocolError）
    api_key = f"{settings.llm_api_key or ''}".strip()
    if not api_key:
        def _missing_key(_messages: list[dict[str, Any]], _tools: list[dict[str, Any]]) -> dict[str, Any]:
            raise RuntimeError(
                "缺少 LLM API Key：请在前端「设置 → 凭据」填写模型 API Key，"
                "或配置环境变量 RETAIN_AI_LLM_API_KEY。"
            )
        return _missing_key
    headers = {"Authorization": f"Bearer {api_key}"}

    def chat(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": settings.llm_model,
            "messages": messages,
            "tools": tools,
            "temperature": 0.2,
        }
        if on_delta is None:
            response = http.post(url, headers=headers, json=body)
            if response.status_code >= 400:
                raise _friendly_llm_error(response.status_code, response.text)
            return response.json()["choices"][0]["message"]
        # 流式:逐 token 经 on_delta 推给上层,同时组装出同构 message 返回
        body["stream"] = True
        with http.stream("POST", url, headers=headers, json=body) as response:
            if response.status_code >= 400:
                # stream 模式 body 未读:先读回错误详情再抛（原实现 raise_for_status
                # 在读 body 前抛,DeepSeek 的错误 JSON 详情直接丢失）
                try:
                    detail = response.read().decode("utf-8", errors="replace")
                except Exception:
                    detail = ""
                raise _friendly_llm_error(response.status_code, detail)
            return assemble_streaming_message(response.iter_lines(), on_delta)

    return chat


class RetrievalAgent:
    def __init__(
        self,
        registry: ToolRegistry,
        chat_fn: ChatFn,
        *,
        max_tool_rounds: int = 6,
    ) -> None:
        self._registry = registry
        self._chat = chat_fn
        self._max_tool_rounds = max(1, max_tool_rounds)

    def ask(
        self,
        question: str,
        *,
        document_id: str = "",
        job_id: str = "",
        on_event: Callable[[dict[str, Any]], None] | None = None,
        chat_fn: ChatFn | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AskResult:
        # chat_fn 覆盖:按请求携带的 LLM key 构造的临时应答器;缺省用启动期的
        emit = on_event or (lambda event: None)
        chat = chat_fn or self._chat
        scoped_document_id = document_id.strip()
        scoped_job_id = job_id.strip()
        user_content = question.strip()
        if scoped_document_id:
            # 硬范围说明 + 工具层强制注入 document_id(见 _scope_tool_arguments)
            user_content = (
                f"(限定文档 document_id={scoped_document_id}"
                f"{f', job_id={scoped_job_id}' if scoped_job_id else ''}"
                f"。search_fulltext / search_favorites / list_documents / read_blocks "
                f"必须只在该文档内操作。)\n{user_content}"
            )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]
        if not (scoped_document_id or scoped_job_id):
            messages[0]["content"] += "\n\n" + (
                "当前请求没有绑定文档。普通聊天、通用知识或连通性测试可以直接回答，"
                "不要求文档检索或引用，也不要声称已读取某篇文档。"
                "若用户确实询问文档内容，应使用检索工具取得证据，"
                "或请用户明确选择文档；不得编造文档内容或引用。"
            )
        # 多轮对话:注入既往轮次(只保留 role/content,工具轨迹不回放)
        for turn in history or []:
            role = str(turn.get("role") or "")
            content = str(turn.get("content") or "").strip()
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_content})
        citations: dict[int, Citation] = {}
        trace: list[dict[str, Any]] = []
        next_ref = 1
        # 整本问答：不暴露 list_documents，避免模型去「浏览图书馆」
        tool_specs = _tool_specs_for_scope(self._registry, scoped_document_id)

        for round_index in range(1, self._max_tool_rounds + 1):
            message = chat(messages, tool_specs)
            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                answer = _sanitize_answer_text(
                    str(message.get("content") or "").strip(), citations
                )
                return AskResult(
                    answer=answer,
                    citations=_referenced_citations(answer, citations),
                    tool_trace=trace,
                    rounds=round_index,
                )
            messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content") or "",
                    "tool_calls": tool_calls,
                }
            )
            for call in tool_calls:
                name = call.get("function", {}).get("name", "")
                # 整本会话硬挡跨库工具
                if scoped_document_id and name == "list_documents":
                    result = {
                        "error": "整本问答不允许浏览图书馆，请用 search_fulltext / read_blocks。",
                        "document_id": scoped_document_id,
                    }
                    emit({"type": "tool", "round": round_index, "tool": name, "arguments": {"skipped": True}})
                    trace.append({"round": round_index, "tool": name, "arguments": {"skipped": True}})
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id", ""),
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )
                    continue
                try:
                    arguments = json.loads(call.get("function", {}).get("arguments") or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                if not isinstance(arguments, dict):
                    arguments = {}
                arguments = _scope_tool_arguments(
                    name,
                    arguments,
                    document_id=scoped_document_id,
                    job_id=scoped_job_id,
                )
                emit({"type": "tool", "round": round_index, "tool": name, "arguments": arguments})
                result = self._registry.invoke(name, arguments)
                next_ref = _assign_refs(result, citations, next_ref)
                trace.append({"round": round_index, "tool": name, "arguments": arguments})
                # 给模型的 payload 去掉 block_id 等内部字段,避免它抄成 [p002-b0004]
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id", ""),
                        "content": json.dumps(
                            _public_tool_payload(result), ensure_ascii=False
                        ),
                    }
                )

        # 轮数耗尽:强制模型基于已有证据收尾(不给工具)
        messages.append(
            {
                "role": "user",
                "content": "请基于以上已检索到的证据直接给出最终回答,不要再调用工具。引用只用 [n]。",
            }
        )
        # 必须用请求级 chat（chat_fn or self._chat）：env 不配 key、前端按请求
        # 传 key 的部署形态下 self._chat 是 _missing_key——跑满工具轮的问题
        # 会在收尾轮误报"缺少 LLM API Key"（审计 A1）。
        message = chat(messages, [])
        answer = _sanitize_answer_text(str(message.get("content") or "").strip(), citations)
        return AskResult(
            answer=answer,
            citations=_referenced_citations(answer, citations),
            tool_trace=trace,
            rounds=self._max_tool_rounds,
        )


def _scope_tool_arguments(
    name: str,
    arguments: dict[str, Any],
    *,
    document_id: str = "",
    job_id: str = "",
) -> dict[str, Any]:
    """整本问答时强制工具落在当前文档/任务,不依赖模型自觉传参。"""
    if not document_id:
        return arguments
    scoped = dict(arguments)
    if name in {"search_fulltext", "search_favorites", "list_documents", "read_blocks"}:
        scoped["document_id"] = document_id
    if name == "read_blocks" and job_id and not str(scoped.get("job_id") or "").strip():
        scoped["job_id"] = job_id
    return scoped


def _tool_specs_for_scope(registry: ToolRegistry, document_id: str = "") -> list[dict[str, Any]]:
    """整本问答时从工具列表拿掉 list_documents，减少无意义的「浏览图书馆」。"""
    specs = registry.specs()
    if not document_id.strip():
        return specs
    filtered: list[dict[str, Any]] = []
    for spec in specs:
        name = str((spec.get("function") or {}).get("name") or "")
        if name == "list_documents":
            continue
        filtered.append(spec)
    return filtered


def _assign_refs(result: dict[str, Any], citations: dict[int, Citation], next_ref: int) -> int:
    """给带锚点的工具结果编引用号,并把编号写回结果(内部仍保留 block_id 供 Citation)。"""
    anchored: list[dict[str, Any]] = []
    anchored.extend(result.get("hits") or [])
    anchored.extend(result.get("favorites") or [])
    # read_blocks: 外层锚点写回每个 block
    blocks = result.get("blocks")
    if isinstance(blocks, list):
        rewritten_blocks: list[dict[str, Any]] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            item = dict(block)
            item.setdefault("document_id", result.get("document_id"))
            item.setdefault("job_id", result.get("job_id"))
            item.setdefault("page_idx", result.get("page_idx"))
            rewritten_blocks.append(item)
            anchored.append(item)
        result["blocks"] = rewritten_blocks
    for entry in anchored:
        if not isinstance(entry, dict):
            continue
        document_id = str(entry.get("document_id") or "")
        block_id = str(entry.get("block_id") or "")
        if not document_id or not block_id:
            continue
        entry["ref"] = next_ref
        snippet = str(
            entry.get("translated_snippet")
            or entry.get("translated_text")
            or entry.get("translated_quote_text")
            or entry.get("source_snippet")
            or entry.get("source_text")
            or entry.get("quote_text")
            or ""
        )
        citations[next_ref] = Citation(
            ref=next_ref,
            document_id=document_id,
            job_id=str(entry.get("job_id") or ""),
            page_idx=int(entry.get("page_idx") or 0),
            block_id=block_id,
            snippet=snippet[:200],
        )
        next_ref += 1
    return next_ref


def _public_anchor(entry: dict[str, Any]) -> dict[str, Any] | None:
    """模型可见的锚点:只有 ref / page(1 基) / snippet,无内部 ID。"""
    ref = entry.get("ref")
    if ref is None:
        return None
    try:
        page_idx = int(entry.get("page_idx") or 0)
    except (TypeError, ValueError):
        page_idx = 0
    snippet = str(
        entry.get("translated_snippet")
        or entry.get("translated_text")
        or entry.get("translated_quote_text")
        or entry.get("source_snippet")
        or entry.get("source_text")
        or entry.get("quote_text")
        or entry.get("snippet")
        or ""
    )[:280]
    return {
        "ref": int(ref),
        "page": page_idx + 1,
        "snippet": snippet,
    }


def _public_tool_payload(result: dict[str, Any]) -> dict[str, Any]:
    """工具原始结果 → 模型上下文。剥离 block_id/job_id 等,避免抄进回答。"""
    if not isinstance(result, dict):
        return {"error": "invalid tool result"}
    if result.get("error"):
        return {"error": str(result.get("error"))}

    public: dict[str, Any] = {}
    if result.get("hint"):
        public["hint"] = str(result.get("hint"))
    if result.get("document_id"):
        # 仅在需要确认范围时给文档 id,一般整本会话已锁定
        public["scoped"] = True

    hits = result.get("hits")
    if isinstance(hits, list):
        public_hits = []
        for hit in hits:
            if isinstance(hit, dict):
                item = _public_anchor(hit)
                if item:
                    public_hits.append(item)
        if public_hits:
            public["hits"] = public_hits
            public["how_to_cite"] = "回答时用 hits[].ref 写成 [1] [2],page 是页码仅供参考。"

    favorites = result.get("favorites")
    if isinstance(favorites, list):
        public_favs = []
        for fav in favorites:
            if isinstance(fav, dict):
                item = _public_anchor(fav)
                if item:
                    public_favs.append(item)
        if public_favs:
            public["favorites"] = public_favs

    blocks = result.get("blocks")
    if isinstance(blocks, list):
        public_blocks = []
        for block in blocks:
            if isinstance(block, dict):
                item = _public_anchor(block)
                if item:
                    public_blocks.append(item)
        if public_blocks:
            public["blocks"] = public_blocks
            public["page"] = int(result.get("page_idx") or 0) + 1
            public["how_to_cite"] = "回答时用 blocks[].ref 写成 [n]。"

    images = result.get("image_urls")
    if isinstance(images, list) and images:
        public["image_urls"] = [str(u) for u in images[:8]]

    # search 命中上挂的 image_urls 已在 hits 剥离时丢掉;从原始 hits 收集
    if isinstance(hits, list):
        img_urls: list[str] = []
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            for u in hit.get("image_urls") or []:
                img_urls.append(str(u))
                if len(img_urls) >= 8:
                    break
            if len(img_urls) >= 8:
                break
        if img_urls:
            public["image_urls"] = img_urls

    if not public:
        public["ok"] = True
    return public


def _sanitize_answer_text(answer: str, citations: dict[int, Citation]) -> str:
    """把正文里的 [p002-b0004] / 裸 block_id 映射成 [n] 或删掉。"""
    if not answer:
        return answer
    by_block = {
        c.block_id.lower().replace("_", "-"): c.ref
        for c in citations.values()
        if c.block_id
    }

    def repl_bracket(match: re.Match[str]) -> str:
        key = match.group(1).lower().replace("_", "-")
        ref = by_block.get(key)
        return f"[{ref}]" if ref is not None else ""

    def repl_bare(match: re.Match[str]) -> str:
        key = match.group(1).lower().replace("_", "-")
        ref = by_block.get(key)
        return f"[{ref}]" if ref is not None else ""

    cleaned = BLOCK_ID_BRACKET_RE.sub(repl_bracket, answer)
    cleaned = BLOCK_ID_BARE_RE.sub(repl_bare, cleaned)
    # 压缩因删除产生的多余空白
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" *\n", "\n", cleaned)
    return cleaned.strip()


def _referenced_citations(answer: str, citations: dict[int, Citation]) -> list[Citation]:
    # 按正文出现顺序保留 [n]，避免 sorted 打乱阅读顺序
    ordered_refs: list[int] = []
    seen: set[int] = set()
    for match in CITATION_RE.findall(answer):
        ref = int(match)
        if ref in seen or ref not in citations:
            continue
        seen.add(ref)
        ordered_refs.append(ref)
    selected = [citations[ref] for ref in ordered_refs]
    # 模型没标 [n] 时：按页去重，最多 3 条，避免前端甩一长串
    if not selected and citations:
        picked: list[Citation] = []
        pages: set[int] = set()
        for ref in sorted(citations):
            item = citations[ref]
            if item.page_idx in pages:
                continue
            pages.add(item.page_idx)
            picked.append(item)
            if len(picked) >= 3:
                break
        return picked
    return selected[:8]
