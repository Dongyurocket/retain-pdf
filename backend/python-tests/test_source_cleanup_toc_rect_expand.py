from __future__ import annotations

import fitz

from services.rendering.source_cleanup.pdf.constants import TOC_PAGE_RIGHT_PAD_PT
from services.rendering.source_cleanup.planning.items import is_toc_item
from services.rendering.source_cleanup.planning.items import item_strip_bbox_for_page
from services.rendering.source_cleanup.planning.items import iter_strip_item_rect_pairs_for_page


def test_is_toc_item_detection() -> None:
    assert is_toc_item({"layout_role": "toc"}) is True
    assert is_toc_item({"semantic_role": "table_of_contents"}) is True
    assert is_toc_item({"structure_role": "toc"}) is True
    assert is_toc_item({"toc_entries": [{"title": "Intro", "page_label": "1"}]}) is True
    assert is_toc_item({"layout_role": "heading"}) is False
    assert is_toc_item({"layout_role": "text"}) is False
    assert is_toc_item({}) is False


def test_item_strip_bbox_for_page_expands_toc() -> None:
    doc = fitz.open()
    page = doc.new_page(width=595.28, height=841.89)  # A4

    toc_item = {
        "item_id": "p008-b001",
        "layout_role": "toc",
        "bbox": [55.0, 180.0, 478.0, 680.0],
    }
    expanded = item_strip_bbox_for_page(toc_item, page)
    expected_x1 = 595.28 + TOC_PAGE_RIGHT_PAD_PT
    assert expanded[0] == 55.0
    assert expanded[1] == 180.0
    assert abs(expanded[2] - expected_x1) < 1e-4
    assert expanded[3] == 680.0

    # Non-TOC item should not expand
    normal_item = {
        "item_id": "p008-b000",
        "layout_role": "heading",
        "bbox": [55.0, 100.0, 200.0, 130.0],
    }
    assert item_strip_bbox_for_page(normal_item, page) == [55.0, 100.0, 200.0, 130.0]

    # Narrow TOC item (less than 40% page width) should not expand
    narrow_toc = {
        "item_id": "p008-b002",
        "layout_role": "toc",
        "bbox": [55.0, 100.0, 150.0, 130.0],
    }
    assert item_strip_bbox_for_page(narrow_toc, page) == [55.0, 100.0, 150.0, 130.0]
    doc.close()


def test_iter_strip_item_rect_pairs_for_page_with_toc() -> None:
    doc = fitz.open()
    page = doc.new_page(width=600.0, height=800.0)

    toc_item = {
        "item_id": "p001-b001",
        "layout_role": "toc",
        "block_kind": "text",
        "translated_text": "目录内容",
        "policy_translate": True,
        "bbox": [50.0, 100.0, 450.0, 700.0],
    }
    pairs = list(iter_strip_item_rect_pairs_for_page(page, [toc_item]))
    assert len(pairs) == 1
    pair = pairs[0]
    # Check that view_rect x1 expanded to page width plus padding
    expected_x1 = 600.0 + TOC_PAGE_RIGHT_PAD_PT
    assert abs(pair.view_rect.x1 - expected_x1) < 1e-4
    doc.close()

