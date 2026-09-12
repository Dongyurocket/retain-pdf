from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import fitz

from services.rendering.source_cleanup.pdf.constants import TOC_MIN_WIDTH_PAGE_RATIO
from services.rendering.source_cleanup.pdf.constants import TOC_PAGE_RIGHT_PAD_PT
from services.rendering.source_cleanup.planning.geometry import ocr_bbox_to_pdf_rect
from services.rendering.source_cleanup.planning.coordinate_resolver import PageBBoxResolver
from services.rendering.source_cleanup.planning.intent_classifier import classify_source_cleanup_intent
from services.rendering.source_cleanup.planning.rects import merge_rects


TOC_ROLE_VALUES = frozenset({"toc", "table_of_contents"})


def is_toc_item(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    if item.get("toc_entries"):
        return True
    roles = {
        str(item.get(key) or "").strip().lower()
        for key in (
            "layout_role",
            "semantic_role",
            "structure_role",
        )
        if item.get(key)
    }
    return bool(roles & TOC_ROLE_VALUES)


def item_strip_bbox_for_page(item: dict, page: fitz.Page) -> list[float]:
    bbox = item.get("bbox") or []
    if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
        return list(bbox)
    if not is_toc_item(item):
        return list(bbox)
    page_width = float(page.rect.width) if page is not None and hasattr(page, "rect") else 0.0
    if page_width <= 0:
        return list(bbox)
    item_width = float(bbox[2]) - float(bbox[0])
    if item_width < page_width * TOC_MIN_WIDTH_PAGE_RATIO:
        return list(bbox)
    target_x1 = max(float(bbox[2]), page_width + TOC_PAGE_RIGHT_PAD_PT)
    return [float(bbox[0]), float(bbox[1]), target_x1, float(bbox[3])]



@dataclass(frozen=True)
class SourceCleanupItemRects:
    item: dict
    pdf_rect: fitz.Rect
    view_rect: fitz.Rect
    probe_rects: tuple[fitz.Rect, ...] = ()


def iter_strip_item_rect_pairs_for_page(
    page: fitz.Page,
    translated_items: list[dict],
    *,
    resolver: PageBBoxResolver | None = None,
    prefiltered: bool = False,
) -> Iterator[SourceCleanupItemRects]:
    active_resolver = resolver or PageBBoxResolver.build(page)
    for item in translated_items:
        if not prefiltered and not item_should_emit_strip_rect(item):
            continue
        bbox = item_strip_bbox_for_page(item, page)
        pdf_rect = active_resolver.ocr_bbox_to_pdf_rect(bbox)
        view_rect = active_resolver.resolve_bbox_rect(bbox)
        probe_rects = active_resolver.resolve_bbox_probe_rects(bbox)
        if pdf_rect is not None and view_rect is not None:
            yield SourceCleanupItemRects(
                item=item,
                pdf_rect=pdf_rect,
                view_rect=view_rect,
                probe_rects=probe_rects or (view_rect,),
            )



def iter_strip_item_rects_for_page(page: fitz.Page, translated_items: list[dict]) -> Iterator[tuple[dict, fitz.Rect]]:
    for pair in iter_strip_item_rect_pairs_for_page(page, translated_items):
        yield pair.item, pair.pdf_rect


def iter_formula_item_rects_for_page(page: fitz.Page, translated_items: list[dict]) -> Iterator[tuple[dict, fitz.Rect]]:
    for item in translated_items:
        if not classify_source_cleanup_intent(item).should_protect_source:
            continue
        rect = ocr_bbox_to_pdf_rect(page, item.get("bbox", []))
        if rect is not None:
            yield item, rect


def build_source_item_rects(page: fitz.Page, translated_items: list[dict]) -> list[fitz.Rect]:
    rects: list[fitz.Rect] = []
    for pair in iter_strip_item_rect_pairs_for_page(page, translated_items):
        if not pair.view_rect.is_empty:
            rects.append(pair.view_rect)
    return merge_rects(rects)


def item_should_emit_strip_rect(item: dict) -> bool:
    return classify_source_cleanup_intent(item).should_strip_text
