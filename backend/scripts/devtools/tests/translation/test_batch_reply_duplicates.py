"""Regression: duplicate item_id in translation reply must not silently overwrite."""

import sys
from pathlib import Path

REPO_SCRIPTS_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_SCRIPTS_ROOT))

from services.translation.llm.providers.deepseek.translation_client import parse_translation_payload


def test_tagged_duplicate_item_id_drops_both() -> None:
    content = (
        "<<<ITEM item_id=a decision=translate>>>first<<<END>>>\n"
        "<<<ITEM item_id=b decision=translate>>>second<<<END>>>\n"
        "<<<ITEM item_id=a decision=translate>>>duplicate-first<<<END>>>\n"
    )
    res = parse_translation_payload(content)
    assert "b" in res
    assert "a" not in res


def test_json_duplicate_item_id_drops_both() -> None:
    content = (
        '{"translations": ['
        '{"item_id": "a", "decision": "translate", "translated_text": "first"},'
        '{"item_id": "b", "decision": "translate", "translated_text": "second"},'
        '{"item_id": "a", "decision": "translate", "translated_text": "duplicate-first"}'
        "]}"
    )
    res = parse_translation_payload(content)
    assert "b" in res
    assert "a" not in res
