"""MCP bridge for the local RetainPDF HTTP API.

The server keeps provider credentials in a local JSON file and exposes the
stable upload/job/artifact operations to stdio MCP clients.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP


LOG = logging.getLogger("retainpdf-mcp")


@dataclass(frozen=True)
class Settings:
    api_base: str
    api_key: str
    paddle_token: str
    deepseek_api_key: str
    deepseek_model: str
    deepseek_base_url: str
    download_dir: Path
    timeout_seconds: float
    poll_interval_seconds: float


def _config_path() -> Path:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config")
    args, _ = parser.parse_known_args()
    value = args.config or os.environ.get("RETAINPDF_MCP_CONFIG")
    if not value:
        raise RuntimeError("RetainPDF MCP config is missing; pass --config or RETAINPDF_MCP_CONFIG")
    return Path(value).expanduser().resolve()


def _load_settings() -> Settings:
    path = _config_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(f"cannot read MCP config: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid MCP config JSON: {path}") from exc

    def value(name: str, env_name: str, default: str = "") -> str:
        return str(raw.get(name) or os.environ.get(env_name) or default).strip()

    api_key = value("api_key", "RETAINPDF_API_KEY")
    if not api_key:
        raise RuntimeError("RetainPDF MCP api_key is missing")
    api_base = value("api_base", "RETAINPDF_API_BASE", "http://127.0.0.1:41000").rstrip("/")
    download_dir = Path(value("download_dir", "RETAINPDF_MCP_DOWNLOAD_DIR", "./output/mcp-downloads"))
    return Settings(
        api_base=api_base,
        api_key=api_key,
        paddle_token=value("paddle_token", "PADDLE_API_KEY"),
        deepseek_api_key=value("deepseek_api_key", "DEEPSEEK_API_KEY"),
        deepseek_model=value("deepseek_model", "RETAINPDF_AI_MODEL", "deepseek-v4-flash"),
        deepseek_base_url=value("deepseek_base_url", "RETAINPDF_AI_BASE_URL", "https://api.deepseek.com/v1").rstrip("/"),
        download_dir=download_dir,
        timeout_seconds=float(raw.get("timeout_seconds", os.environ.get("RETAINPDF_MCP_TIMEOUT", 120))),
        poll_interval_seconds=float(raw.get("poll_interval_seconds", 5)),
    )


settings = _load_settings()
mcp = FastMCP(
    "retain-pdf",
    instructions=(
        "Local RetainPDF PDF OCR, translation, rendering, job tracking, and artifact tools. "
        "Use translate_pdf for the normal workflow, then wait_for_job and download_artifact."
    ),
)


def _headers() -> dict[str, str]:
    return {"X-API-Key": settings.api_key}


def _path(value: str) -> str:
    return quote(str(value), safe="")


def _unwrap(response: httpx.Response) -> Any:
    try:
        payload = response.json()
    except ValueError as exc:
        detail = response.text[:300].replace("\n", " ")
        raise RuntimeError(f"RetainPDF returned non-JSON HTTP {response.status_code}: {detail}") from exc
    if response.status_code >= 400:
        message = payload.get("message", "request failed") if isinstance(payload, dict) else "request failed"
        raise RuntimeError(f"RetainPDF HTTP {response.status_code}: {message}")
    if isinstance(payload, dict) and "code" in payload:
        code = payload.get("code")
        if code not in (0, "0", None):
            raise RuntimeError(f"RetainPDF API error {code}: {payload.get('message', 'request failed')}")
        return payload.get("data", payload)
    return payload


async def _json(method: str, path: str, **kwargs: Any) -> Any:
    async with httpx.AsyncClient(base_url=settings.api_base, headers=_headers(), timeout=settings.timeout_seconds, trust_env=False) as client:
        response = await client.request(method, path, **kwargs)
    return _unwrap(response)


async def _upload(file_path: str, developer_mode: bool = False) -> Any:
    source = Path(file_path).expanduser().resolve()
    if not source.is_file():
        raise RuntimeError(f"PDF file does not exist: {source}")
    if source.suffix.lower() != ".pdf":
        raise RuntimeError(f"RetainPDF expects a .pdf file: {source}")
    with source.open("rb") as handle:
        async with httpx.AsyncClient(base_url=settings.api_base, headers=_headers(), timeout=settings.timeout_seconds, trust_env=False) as client:
            response = await client.post(
                "/api/v1/uploads",
                files={"file": (source.name, handle, "application/pdf")},
                data={"developer_mode": str(developer_mode).lower()},
            )
    return _unwrap(response)


def _job_payload(
    upload_id: str,
    workflow: str,
    provider: str,
    paddle_token: str,
    translation_api_key: str,
    model: str,
    base_url: str,
    mode: str,
    math_mode: str,
    language: str,
    page_ranges: str,
    render_mode: str,
    glossary_id: str,
    workers: int,
    batch_size: int,
    compile_workers: int,
    timeout_seconds: int,
    artifact_job_id: str,
) -> dict[str, Any]:
    ocr: dict[str, Any] = {"provider": provider, "language": language}
    if page_ranges:
        ocr["page_ranges"] = page_ranges
    if provider == "paddle":
        ocr["paddle_token"] = paddle_token or settings.paddle_token
    elif provider == "mineru":
        ocr["mineru_token"] = paddle_token or settings.paddle_token
    translation: dict[str, Any] = {
        "mode": mode,
        "math_mode": math_mode,
        "model": model or settings.deepseek_model,
        "base_url": base_url or settings.deepseek_base_url,
        "api_key": translation_api_key or settings.deepseek_api_key,
        "batch_size": batch_size,
        "workers": workers,
    }
    if glossary_id:
        translation["glossary_id"] = glossary_id
    source: dict[str, Any] = {"upload_id": upload_id}
    if artifact_job_id:
        source["artifact_job_id"] = artifact_job_id
    payload: dict[str, Any] = {"workflow": workflow, "source": source, "ocr": ocr}
    if workflow != "render":
        payload["translation"] = translation
    if workflow in ("book", "render"):
        payload["render"] = {"render_mode": render_mode, "compile_workers": compile_workers}
    payload["runtime"] = {"timeout_seconds": timeout_seconds}
    return payload


async def _create_job(**kwargs: Any) -> Any:
    return await _json("POST", "/api/v1/jobs", json=_job_payload(**kwargs))


async def _job(job_id: str) -> Any:
    return await _json("GET", f"/api/v1/jobs/{_path(job_id)}")


async def _wait(job_id: str, timeout_seconds: int, poll_interval_seconds: float) -> Any:
    deadline = asyncio.get_running_loop().time() + max(1, min(timeout_seconds, 86400))
    terminal = {"succeeded", "failed", "canceled", "cancelled"}
    last: Any = None
    while True:
        last = await _job(job_id)
        status = str(last.get("status", "")).lower() if isinstance(last, dict) else ""
        if status in terminal:
            return last
        if asyncio.get_running_loop().time() >= deadline:
            return {"timed_out": True, "job": last}
        await asyncio.sleep(max(0.5, poll_interval_seconds))


@mcp.tool()
async def retainpdf_health() -> dict[str, Any]:
    """Check whether the local RetainPDF Rust API is healthy."""
    return await _json("GET", "/health")


@mcp.tool()
async def retainpdf_translate_pdf(
    file_path: str,
    workflow: str = "book",
    provider: str = "paddle",
    model: str = "",
    mode: str = "sci",
    page_ranges: str = "",
    language: str = "ch",
    render_mode: str = "auto",
    glossary_id: str = "",
    workers: int = 50,
    batch_size: int = 1,
    compile_workers: int = 8,
    timeout_seconds: int = 1800,
    wait_for_completion: bool = False,
    output_path: str = "",
) -> dict[str, Any]:
    """Upload a PDF and create a RetainPDF OCR/translation/render job.

    Set wait_for_completion=true to wait for a terminal job state. If output_path
    is also supplied, the completed ZIP bundle is downloaded there.
    """
    upload = await _upload(file_path)
    upload_id = str(upload.get("upload_id", ""))
    if not upload_id:
        raise RuntimeError("RetainPDF upload response did not contain upload_id")
    job = await _create_job(
        upload_id=upload_id,
        workflow=workflow,
        provider=provider,
        paddle_token="",
        translation_api_key="",
        model=model,
        base_url="",
        mode=mode,
        math_mode="direct_typst",
        language=language,
        page_ranges=page_ranges,
        render_mode=render_mode,
        glossary_id=glossary_id,
        workers=workers,
        batch_size=batch_size,
        compile_workers=compile_workers,
        timeout_seconds=timeout_seconds,
        artifact_job_id="",
    )
    result: dict[str, Any] = {"upload": upload, "job": job}
    job_id = str(job.get("job_id", "")) if isinstance(job, dict) else ""
    if wait_for_completion and job_id:
        final = await _wait(job_id, timeout_seconds, settings.poll_interval_seconds)
        result["final"] = final
        if output_path and isinstance(final, dict) and final.get("status") == "succeeded":
            result["download"] = await _download(job_id, "download", output_path)
    return result


@mcp.tool()
async def retainpdf_upload_pdf(file_path: str, developer_mode: bool = False) -> dict[str, Any]:
    """Upload a local PDF and return its RetainPDF upload metadata."""
    return await _upload(file_path, developer_mode)


@mcp.tool()
async def retainpdf_create_job(
    upload_id: str,
    workflow: str = "book",
    provider: str = "paddle",
    model: str = "",
    base_url: str = "",
    mode: str = "sci",
    math_mode: str = "direct_typst",
    language: str = "ch",
    page_ranges: str = "",
    render_mode: str = "auto",
    glossary_id: str = "",
    workers: int = 50,
    batch_size: int = 1,
    compile_workers: int = 8,
    timeout_seconds: int = 1800,
    artifact_job_id: str = "",
) -> dict[str, Any]:
    """Create a job from an existing RetainPDF upload_id."""
    return await _create_job(
        upload_id=upload_id, workflow=workflow, provider=provider, paddle_token="",
        translation_api_key="", model=model, base_url=base_url, mode=mode,
        math_mode=math_mode, language=language, page_ranges=page_ranges,
        render_mode=render_mode, glossary_id=glossary_id, workers=workers,
        batch_size=batch_size, compile_workers=compile_workers,
        timeout_seconds=timeout_seconds, artifact_job_id=artifact_job_id,
    )


@mcp.tool()
async def retainpdf_list_jobs(limit: int = 20, offset: int = 0, status: str = "", workflow: str = "", provider: str = "") -> Any:
    """List recent RetainPDF jobs, optionally filtered by status/workflow/provider."""
    params: dict[str, Any] = {"limit": max(1, min(limit, 100)), "offset": max(0, offset)}
    for key, value in (("status", status), ("workflow", workflow), ("provider", provider)):
        if value:
            params[key] = value
    return await _json("GET", "/api/v1/jobs", params=params)


@mcp.tool()
async def retainpdf_get_job(job_id: str) -> Any:
    """Read the full status and runtime details for one job."""
    return await _job(job_id)


@mcp.tool()
async def retainpdf_wait_for_job(job_id: str, timeout_seconds: int = 3600, poll_interval_seconds: float = 5) -> Any:
    """Poll a job until it succeeds, fails, is canceled, or the timeout expires."""
    return await _wait(job_id, timeout_seconds, poll_interval_seconds)


@mcp.tool()
async def retainpdf_get_job_events(job_id: str, limit: int = 200, offset: int = 0) -> Any:
    """Read the canonical event stream for a job."""
    return await _json("GET", f"/api/v1/jobs/{_path(job_id)}/events", params={"limit": max(1, min(limit, 1000)), "offset": max(0, offset)})


@mcp.tool()
async def retainpdf_get_artifacts_manifest(job_id: str) -> Any:
    """List the published artifacts and readiness state for a job."""
    return await _json("GET", f"/api/v1/jobs/{_path(job_id)}/artifacts-manifest")


async def _download(job_id: str, artifact: str, output_path: str = "") -> dict[str, Any]:
    endpoints = {
        "pdf": (f"/api/v1/jobs/{_path(job_id)}/pdf", ".pdf"),
        "markdown": (f"/api/v1/jobs/{_path(job_id)}/markdown?raw=true", ".md"),
        "download": (f"/api/v1/jobs/{_path(job_id)}/download", ".zip"),
        "normalized-document": (f"/api/v1/jobs/{_path(job_id)}/normalized-document", ".json"),
        "normalization-report": (f"/api/v1/jobs/{_path(job_id)}/normalization-report", ".json"),
    }
    endpoint, suffix = endpoints.get(artifact, (f"/api/v1/jobs/{_path(job_id)}/artifacts/{_path(artifact)}", ""))
    destination = Path(output_path).expanduser().resolve() if output_path else settings.download_dir / f"{job_id}-{artifact.replace('/', '_')}{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(base_url=settings.api_base, headers=_headers(), timeout=settings.timeout_seconds, trust_env=False) as client:
        async with client.stream("GET", endpoint) as response:
            if response.status_code >= 400:
                body = (await response.aread()).decode("utf-8", "replace")[:300]
                raise RuntimeError(f"RetainPDF download HTTP {response.status_code}: {body}")
            size = 0
            with destination.open("wb") as handle:
                async for chunk in response.aiter_bytes():
                    handle.write(chunk)
                    size += len(chunk)
    return {"job_id": job_id, "artifact": artifact, "path": str(destination), "bytes": size}


@mcp.tool()
async def retainpdf_download_artifact(job_id: str, artifact: str = "download", output_path: str = "") -> dict[str, Any]:
    """Download a job artifact to the local filesystem.

    artifact can be pdf, markdown, download, normalized-document,
    normalization-report, or an artifact registry key.
    """
    return await _download(job_id, artifact, output_path)


@mcp.tool()
async def retainpdf_read_markdown(job_id: str, max_chars: int = 50000) -> dict[str, Any]:
    """Read the raw translated Markdown for a completed job."""
    async with httpx.AsyncClient(base_url=settings.api_base, headers=_headers(), timeout=settings.timeout_seconds, trust_env=False) as client:
        response = await client.get(f"/api/v1/jobs/{_path(job_id)}/markdown", params={"raw": "true"})
    if response.status_code >= 400:
        _unwrap(response)
    text = response.text
    limit = max(1, min(max_chars, 500000))
    return {"job_id": job_id, "content": text[:limit], "truncated": len(text) > limit, "characters": len(text)}


@mcp.tool()
async def retainpdf_cancel_job(job_id: str) -> Any:
    """Cancel a queued or running RetainPDF job."""
    return await _json("POST", f"/api/v1/jobs/{_path(job_id)}/cancel")


@mcp.tool()
async def retainpdf_list_ocr_providers() -> Any:
    """List OCR providers supported by the connected local RetainPDF desktop service."""
    return await _json("GET", "/api/v1/providers/ocr")


@mcp.tool()
async def retainpdf_list_documents(
    limit: int = 20,
    offset: int = 0,
    query: str = "",
    reading_status: str = "",
    tag: str = "",
) -> Any:
    """List documents in the local desktop library, optionally filtered by text, reading status, or tag."""
    params: dict[str, Any] = {"limit": max(1, min(limit, 100)), "offset": max(0, offset)}
    for key, value in (("q", query), ("reading_status", reading_status), ("tag", tag)):
        if value:
            params[key] = value
    return await _json("GET", "/api/v1/documents", params=params)


@mcp.tool()
async def retainpdf_get_document(document_id: str) -> Any:
    """Read a document and its active RetainPDF job metadata from the local desktop library."""
    normalized_document_id = str(document_id or "").strip()
    if not normalized_document_id:
        raise RuntimeError("document_id is required")
    return await _json("GET", f"/api/v1/documents/{_path(normalized_document_id)}")


@mcp.tool()
async def retainpdf_list_glossaries() -> Any:
    """List translation glossaries stored by the connected local desktop service."""
    return await _json("GET", "/api/v1/glossaries")


@mcp.tool()
async def retainpdf_get_glossary(glossary_id: str) -> Any:
    """Read one translation glossary and its entries from the local desktop service."""
    normalized_glossary_id = str(glossary_id or "").strip()
    if not normalized_glossary_id:
        raise RuntimeError("glossary_id is required")
    return await _json("GET", f"/api/v1/glossaries/{_path(normalized_glossary_id)}")


@mcp.tool()
async def retainpdf_list_library_books(limit: int = 20, offset: int = 0, query: str = "") -> Any:
    """List processed books in the RetainPDF library."""
    params: dict[str, Any] = {"limit": max(1, min(limit, 100)), "offset": max(0, offset)}
    if query:
        params["q"] = query
    return await _json("GET", "/api/v1/library/books", params=params)


@mcp.tool()
async def retainpdf_reader_chat(job_id: str, message: str, page: int | None = None, history: list[dict[str, Any]] | None = None) -> Any:
    """Ask a question about a completed translated PDF using configured DeepSeek."""
    context: dict[str, Any] = {}
    if page is not None and page > 0:
        context["page"] = page
    body: dict[str, Any] = {
        "message": message,
        "scope": "document",
        "provider": "deepseek",
        "model": "deepseek-chat",
        "api_key": settings.deepseek_api_key,
        "base_url": settings.deepseek_base_url,
        "context": context,
        "history": history or [],
    }
    return await _json("POST", f"/api/v1/jobs/{_path(job_id)}/reader/ai/chat", json=body)


if __name__ == "__main__":
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    mcp.run("stdio")
