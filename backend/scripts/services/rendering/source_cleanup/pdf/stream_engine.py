from __future__ import annotations

from dataclasses import dataclass

import fitz
import pikepdf

from services.rendering.source_cleanup.pdf.hit_test import RectIndex
from services.rendering.source_cleanup.pdf.hit_test import RectTuple
from services.rendering.source_cleanup.pdf.hit_test import is_protected_text_op
from services.rendering.source_cleanup.pdf.path_removal import PATH_CONSTRUCTION_OPERATORS
from services.rendering.source_cleanup.pdf.path_removal import PATH_PAINT_OPERATORS
from services.rendering.source_cleanup.pdf.path_removal import PathTracker
from services.rendering.source_cleanup.pdf.path_removal import decide_path_paint_rewrite
from services.rendering.source_cleanup.pdf.pdf_math import IDENTITY_MATRIX
from services.rendering.source_cleanup.pdf.pdf_math import PdfMatrix
from services.rendering.source_cleanup.pdf.text_ops import TEXT_SHOW_OPERATORS
from services.rendering.source_cleanup.pdf.stream_state import ContentStreamState
from services.rendering.source_cleanup.pdf.text_removal import decide_text_show_rewrite
from services.rendering.source_cleanup.pdf.xobject_ops import rewrite_xobject_do
from services.rendering.source_cleanup.pdf.xobject_ops import xobject_dict

# Same-line continuation removal for advance-estimate overshoot.
# The engine estimates each text op's position by simulating glyph advances
# with a nominal 0.5em width (real font widths are unavailable). Long
# dot-leader TJ arrays (TOC lines, e.g. "Title ....... 357") overshoot the
# simulated text cursor far past the strip rect's right edge, so the trailing
# page-number op is misjudged as "outside every strip rect" and survives;
# with its preceding ops physically deleted it then repaints at the line
# start, overlapping the translated overlay. When a removed op's estimated
# rect spills past the right edge of the strip rect it matched (the
# signature of an overshooting estimate), subsequent ops on the same
# baseline within a bounded horizontal range are removed as well.
LINE_OVERSHOOT_EPS_PT = 1.0
LINE_CONTINUATION_Y_TOL_PT = 1.5
LINE_CONTINUATION_MIN_RANGE_PT = 240.0
LINE_CONTINUATION_WIDTH_RATIO = 0.75


@dataclass
class _LineContinuationState:
    """Armed same-line continuation removal state."""

    line_y: float = 0.0
    floor_x: float = 0.0
    limit_x: float = 0.0
    band: RectTuple | None = None

    def clear(self) -> None:
        self.band = None

    def arm(self, *, line_y: float, floor_x: float, matched_rect: RectTuple) -> None:
        width = max(matched_rect[2] - matched_rect[0], 0.0)
        self.line_y = line_y
        self.floor_x = floor_x
        self.limit_x = matched_rect[2] + max(
            LINE_CONTINUATION_MIN_RANGE_PT,
            LINE_CONTINUATION_WIDTH_RATIO * width,
        )
        self.band = matched_rect

    def matches(self, *, user_y: float, text_rect: RectTuple) -> bool:
        if self.band is None:
            return False
        if abs(user_y - self.line_y) > LINE_CONTINUATION_Y_TOL_PT:
            return False
        if not _rects_overlap_y(text_rect, self.band):
            return False
        return self.floor_x - LINE_OVERSHOOT_EPS_PT <= text_rect[0] <= self.limit_x

    def extend(self, text_rect: RectTuple) -> None:
        self.floor_x = max(self.floor_x, text_rect[0])


def _rects_overlap_y(rect: RectTuple, other: RectTuple, tol: float = 1.0) -> bool:
    return rect[3] > other[1] - tol and rect[1] < other[3] + tol


def strip_bbox_text_from_page(
    page: pikepdf.Page,
    rects: list[fitz.Rect],
    *,
    pdf: pikepdf.Pdf | None = None,
    protected_rects: list[fitz.Rect] | None = None,
    recurse_forms: bool = True,
) -> tuple[bytes | None, int, int]:
    return strip_bbox_text_from_stream(
        page,
        rects,
        pdf=pdf,
        protected_rects=protected_rects,
        recurse_forms=recurse_forms,
    )


def strip_bbox_text_from_stream(
    stream_obj: pikepdf.Page | pikepdf.Object,
    rects: list[fitz.Rect],
    *,
    pdf: pikepdf.Pdf | None = None,
    protected_rects: list[fitz.Rect] | None = None,
    recurse_forms: bool = True,
    initial_ctm: PdfMatrix = IDENTITY_MATRIX,
    visited_forms: set[tuple[int, int]] | None = None,
) -> tuple[bytes | None, int, int]:
    parsed_instructions = pikepdf.parse_content_stream(stream_obj)
    instructions = parsed_instructions if isinstance(parsed_instructions, list) else list(parsed_instructions)
    if not instructions or not rects:
        return None, 0, 0

    output: list[tuple] = []
    protected_rects = protected_rects or []
    strip_index = RectIndex.build(rects)
    protected_index = RectIndex.build(protected_rects)
    removed = 0
    path_removed = 0
    forms_changed = 0
    state = ContentStreamState(ctm=initial_ctm)
    path_tracker = PathTracker.empty()
    pending_path_ops: list[tuple] = []
    q_depth = 0
    line_continuation = _LineContinuationState()
    # Text rendered with Tr 4-7 contributes its glyphs to the clip path.
    # Once such text is removed, subsequent painting inside the same q..Q
    # scope loses that clip and would repaint unbounded (e.g. InDesign link
    # highlight rects spanning the whole page). Track the q-depth where this
    # happened and drop path construction/painting until the matching Q.
    clip_text_removed_depth: int | None = None

    xobjects = xobject_dict(stream_obj)

    for operands, operator in instructions:
        op = str(operator)
        if clip_text_removed_depth is not None and q_depth >= clip_text_removed_depth:
            if op in PATH_CONSTRUCTION_OPERATORS:
                continue
            if op in PATH_PAINT_OPERATORS:
                if pending_path_ops:
                    pending_path_ops.clear()
                    path_tracker.clear()
                path_removed += 1
                continue
        if op == "q":
            q_depth += 1
        elif op == "Q":
            if q_depth > 0:
                q_depth -= 1
            if clip_text_removed_depth is not None and q_depth < clip_text_removed_depth:
                clip_text_removed_depth = None
        if state.apply_state_operator(op, operands):
            if op == "BT":
                line_continuation.clear()
            output.append((operands, operator))
            continue
        if op == "Do" and operands:
            xobject_result = rewrite_xobject_do(
                operands=operands,
                xobjects=xobjects,
                rects=rects,
                pdf=pdf,
                protected_rects=protected_rects,
                recurse_forms=recurse_forms,
                ctm=state.ctm,
                visited_forms=visited_forms,
                rewrite_stream=_rewrite_stream_for_form,
            )
            operands = xobject_result.operands
            removed += xobject_result.removed
            forms_changed += xobject_result.forms_changed
            output.append((operands, operator))
            continue
        if op in {"'", '"'}:
            state.prepare_quote_text_show(op, operands)

        if op in TEXT_SHOW_OPERATORS:
            text_decision = decide_text_show_rewrite(
                operands=operands,
                ctm=state.ctm,
                text_matrix=state.text_matrix,
                text_state=state.text_state,
                strip_index=strip_index,
                protected_index=protected_index,
            )
            if line_continuation.band is not None and (
                abs(text_decision.user_point[1] - line_continuation.line_y)
                > LINE_CONTINUATION_Y_TOL_PT
            ):
                line_continuation.clear()
            continuation_remove = False
            if (
                not text_decision.remove
                and line_continuation.matches(
                    user_y=text_decision.user_point[1],
                    text_rect=text_decision.text_rect,
                )
                and not is_protected_text_op(
                    user_point=text_decision.user_point,
                    text_rect=text_decision.text_rect,
                    protected_index=protected_index,
                )
            ):
                continuation_remove = True
                line_continuation.extend(text_decision.text_rect)
            state.advance_text(operands, text_metrics=text_decision.text_metrics)
            if text_decision.remove or continuation_remove:
                removed += 1
                if state.text_state is not None and state.text_state.render_mode >= 4:
                    clip_text_removed_depth = q_depth
                if (
                    not continuation_remove
                    and text_decision.matched_rect is not None
                    and text_decision.text_rect[2]
                    > text_decision.matched_rect[2] + LINE_OVERSHOOT_EPS_PT
                    and _rects_overlap_y(text_decision.text_rect, text_decision.matched_rect)
                ):
                    line_continuation.arm(
                        line_y=text_decision.user_point[1],
                        floor_x=text_decision.text_rect[0],
                        matched_rect=text_decision.matched_rect,
                    )
                continue

        if op in PATH_CONSTRUCTION_OPERATORS:
            path_tracker.record(op, operands, state.ctm)
            pending_path_ops.append((operands, operator))
            continue

        if op in PATH_PAINT_OPERATORS and pending_path_ops:
            path_decision = decide_path_paint_rewrite(
                op=op,
                path_rect=path_tracker.rect(),
                strip_index=strip_index,
                protected_index=protected_index,
            )
            path_tracker.clear()
            if path_decision.remove:
                pending_path_ops.clear()
                path_removed += 1
                continue
            output.extend(pending_path_ops)
            pending_path_ops.clear()

        output.append((operands, operator))

    output.extend(pending_path_ops)
    removed += path_removed
    if removed <= 0:
        return None, 0, forms_changed
    return pikepdf.unparse_content_stream(output), removed, forms_changed


def _rewrite_stream_for_form(
    stream_obj: pikepdf.Object,
    rects: list[fitz.Rect],
    pdf: pikepdf.Pdf,
    protected_rects: list[fitz.Rect],
    recurse_forms: bool,
    initial_ctm: PdfMatrix,
    visited_forms: set[tuple[int, int]],
) -> tuple[bytes | None, int, int]:
    return strip_bbox_text_from_stream(
        stream_obj,
        rects,
        pdf=pdf,
        protected_rects=protected_rects,
        recurse_forms=recurse_forms,
        initial_ctm=initial_ctm,
        visited_forms=visited_forms,
    )
