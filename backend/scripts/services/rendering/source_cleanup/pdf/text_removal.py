from __future__ import annotations

from dataclasses import dataclass

from services.rendering.source_cleanup.pdf.hit_test import RectIndex
from services.rendering.source_cleanup.pdf.hit_test import RectTuple
from services.rendering.source_cleanup.pdf.hit_test import is_protected_text_op
from services.rendering.source_cleanup.pdf.pdf_math import PdfMatrix
from services.rendering.source_cleanup.pdf.text_ops import TextOperandMetrics
from services.rendering.source_cleanup.pdf.text_ops import TextState
from services.rendering.source_cleanup.pdf.text_ops import estimated_user_text_geometry
from services.rendering.source_cleanup.pdf.text_ops import text_operand_metrics


@dataclass(frozen=True)
class TextShowRewriteDecision:
    text_metrics: TextOperandMetrics
    user_point: tuple[float, float]
    text_rect: RectTuple
    remove: bool
    matched_rect: RectTuple | None = None


def decide_text_show_rewrite(
    *,
    operands: object,
    ctm: PdfMatrix,
    text_matrix: PdfMatrix,
    text_state: TextState,
    strip_index: RectIndex,
    protected_index: RectIndex,
) -> TextShowRewriteDecision:
    text_metrics = text_operand_metrics(operands)
    user_point, text_rect = estimated_user_text_geometry(
        ctm,
        text_matrix,
        text_state,
        text_length=text_metrics[0],
    )
    matched_rect = strip_index.matching_rect_for_removal(
        user_point[0],
        user_point[1],
        text_rect,
    )
    remove = matched_rect is not None and not is_protected_text_op(
        user_point=user_point,
        text_rect=text_rect,
        protected_index=protected_index,
    )
    return TextShowRewriteDecision(
        text_metrics=text_metrics,
        user_point=user_point,
        text_rect=text_rect,
        remove=remove,
        matched_rect=matched_rect,
    )
