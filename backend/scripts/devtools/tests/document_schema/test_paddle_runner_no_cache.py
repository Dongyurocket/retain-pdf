from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import fitz

REPO_SCRIPTS_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_SCRIPTS_ROOT))

from services.ocr_provider.paddle_runner import run_paddle_to_job_dir


def _write_source_pdf(path: Path) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=320, height=480)
    page.insert_text((72, 72), "paddle no_cache smoke")
    doc.save(path)
    doc.close()
    return path.read_bytes()


def _make_args(tmp_path: Path, *, file_url: str = "", file_path: str = "", no_cache: bool) -> SimpleNamespace:
    root = tmp_path / "job"
    dirs = {name: root / name for name in ("source", "ocr", "translated", "rendered", "artifacts", "logs")}
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(
        paddle_token="token",
        paddle_api_url="",
        paddle_model="PaddleOCR-VL-1.6",
        file_url=file_url,
        file_path=file_path,
        poll_interval=1,
        poll_timeout=10,
        no_cache=no_cache,
        job_root=str(root),
        source_dir=str(dirs["source"]),
        ocr_dir=str(dirs["ocr"]),
        translated_dir=str(dirs["translated"]),
        rendered_dir=str(dirs["rendered"]),
        artifacts_dir=str(dirs["artifacts"]),
        logs_dir=str(dirs["logs"]),
    )


def _run_with_fakes(args: SimpleNamespace, *, submit_local, submit_remote, download_source_pdf=None):
    captured: dict[str, Path] = {}

    def _submit_local(*, token, file_path, model, optional_payload, base_url):
        captured["submit_path"] = Path(file_path)
        captured["submit_bytes"] = Path(file_path).read_bytes()
        return "task-1", "trace-1"

    def _submit_remote(*, token, source_url, model, optional_payload, base_url):
        captured["submit_remote_url"] = source_url
        return "task-1", "trace-1"

    def _wrapped_local(**kwargs):
        if submit_local is not None:
            submit_local(**kwargs)
        return _submit_local(**kwargs)

    def _wrapped_remote(**kwargs):
        if submit_remote is not None:
            submit_remote(**kwargs)
        return _submit_remote(**kwargs)

    run_paddle_to_job_dir(
        args,
        download_source_pdf=download_source_pdf or (lambda url, source_dir: Path(args.file_path)),
        get_token=lambda explicit_value="": "token",
        submit_remote=_wrapped_remote,
        submit_local=_wrapped_local,
        poll_until_complete=lambda **kwargs: ({}, "https://example.com/result.jsonl"),
        download_jsonl=lambda jsonl_url: {},
        materialize_markdown=lambda payload, job_root: None,
        save_normalized_document=lambda **kwargs: None,
        save_json_file=lambda *a, **kwargs: None,
        normalize_model=lambda model: model,
        build_optional_request_payload=lambda model: {},
    )
    return captured


def test_paddle_no_cache_submits_cache_busted_copy(tmp_path: Path) -> None:
    args = _make_args(tmp_path, file_path="", no_cache=True)
    source_pdf = tmp_path / "job" / "source" / "book.pdf"
    original_bytes = _write_source_pdf(source_pdf)
    args.file_path = str(source_pdf)

    captured = _run_with_fakes(args, submit_local=None, submit_remote=None)

    submit_path = captured["submit_path"]
    assert submit_path != source_pdf
    assert captured["submit_bytes"].startswith(original_bytes)
    assert b"retain-pdf no-cache bust" in captured["submit_bytes"]
    assert not submit_path.exists(), "temp copy must be removed after submit"
    assert source_pdf.read_bytes() == original_bytes, "source file must stay untouched"


def test_paddle_default_submits_original_file(tmp_path: Path) -> None:
    args = _make_args(tmp_path, file_path="", no_cache=False)
    source_pdf = tmp_path / "job" / "source" / "book.pdf"
    original_bytes = _write_source_pdf(source_pdf)
    args.file_path = str(source_pdf)

    captured = _run_with_fakes(args, submit_local=None, submit_remote=None)

    assert captured["submit_path"] == source_pdf
    assert captured["submit_bytes"] == original_bytes


def test_paddle_no_cache_remote_url_falls_back_to_busted_local_upload(tmp_path: Path) -> None:
    args = _make_args(tmp_path, file_url="https://example.com/book.pdf", file_path="", no_cache=True)
    source_pdf = tmp_path / "job" / "source" / "book.pdf"
    _write_source_pdf(source_pdf)
    args.file_path = str(source_pdf)
    remote_calls: list[str] = []

    captured = _run_with_fakes(
        args,
        submit_local=None,
        submit_remote=lambda **kwargs: remote_calls.append(kwargs["source_url"]),
    )

    assert remote_calls == [], "no_cache must not resubmit the same remote URL"
    assert b"retain-pdf no-cache bust" in captured["submit_bytes"]
