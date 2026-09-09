"""Group completion regressions: joined members with own translations stay complete."""

import sys
from pathlib import Path

REPO_SCRIPTS_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_SCRIPTS_ROOT))

from services.translation.core.payload.parts.units import pending_translation_items


def _review_joined_member(item_id: str, source: str, member_text: str) -> dict:
    return {
        "item_id": item_id,
        "page_idx": 1,
        "block_idx": 0,
        "block_type": "text",
        "should_translate": True,
        "continuation_group": "cg-review-1002",
        "translation_unit_id": "__cg__:cg-review-1002",
        "translation_unit_member_ids": ["p002-b011", "p002-b012"],
        "continuation_decision": "review_joined",
        "protected_source_text": source,
        "protected_translated_text": member_text,
    }


def test_review_joined_members_with_own_texts_stay_complete() -> None:
    # Regression for job 20260904024653-65f2da: review joined two already
    # translated singles; members carry different texts but each
    # has its own member translation, so the group must not go pending.
    payload = [
        _review_joined_member("p002-b011", "first half", "前半译文"),
        _review_joined_member("p002-b012", "second half", "后半译文"),
    ]
    assert pending_translation_items(payload) == []
