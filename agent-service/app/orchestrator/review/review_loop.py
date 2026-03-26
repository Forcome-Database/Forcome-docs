"""Shared Review loop extracted from OrchestratorEngine.

Both L2 (_execute_structured_write_from_brief) and L3 (_execute_level3) used
nearly identical review-fix-re-evaluate cycles.  This module provides a single
``run_review_loop`` coroutine that both call sites delegate to.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Awaitable

from app.agent.events import emit
from app.orchestrator.session_store import session_store
from app.orchestrator.tools.fix_tools import fix_selected_issues
from app.models.blueprint import CreationBlueprint
from app.models.brief import CreationBrief


# ---------------------------------------------------------------------------
# Configurable messages – the only thing that differs between L2 and L3
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ReviewMessages:
    """Locale-specific messages injected by each call site."""

    timeout_message: str
    """Passed to _await_user_input as timeout_message."""

    timeout_blocking_error: str
    """RuntimeError text when review times out with unresolved blocking issues."""

    skip_blocked_message: str
    """Emitted when user tries to skip but blocking structure/length/asset issues remain."""

    no_selection_message: str
    """Emitted when user submits without selecting issues and without skip."""

    alignment_error: str
    """RuntimeError text when section set is inconsistent with blueprint."""


# Defaults matching the L2 (English) call site
L2_MESSAGES = ReviewMessages(
    timeout_message="Timed out waiting for review confirmation (10 min). Content below target.",
    timeout_blocking_error="Review timed out with unresolved blocking issues. Cannot finalize.",
    skip_blocked_message="Blocking structure/length/asset issues remain. Cannot skip to finalize.",
    no_selection_message="Select issues to fix. Only visual issues can be skipped.",
    alignment_error="Section set inconsistent with blueprint. Cannot finalize.",
)

# Defaults matching the L3 (Chinese) call site
L3_MESSAGES = ReviewMessages(
    timeout_message="等待评审确认超时（10分钟），当前内容仍未达标",
    timeout_blocking_error="评审超时，仍存在未解决的阻塞问题，无法完成",
    skip_blocked_message="仍存在必须修复的结构、长度或素材问题，无法直接跳过完成",
    no_selection_message="请选择要修复的问题；只有视觉问题才允许跳过完成",
    alignment_error="章节集合与 blueprint 不一致，无法 finalize",
)


# ---------------------------------------------------------------------------
# Type aliases for the two engine callbacks we need
# ---------------------------------------------------------------------------

AwaitUserInputFn = Callable[..., Awaitable[dict | None]]
BuildReviewReportFn = Callable[..., Awaitable[tuple[Any, list]]]
EmitDraftPreviewFn = Callable[..., Awaitable[None]]
HasBlockingIssuesFn = Callable[..., bool]


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------

async def run_review_loop(
    *,
    review_report: Any,
    section_drafts: list,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: Any,
    thread_id: str,
    page_id: str | None,
    messages: ReviewMessages,
    # Engine callbacks
    await_user_input: AwaitUserInputFn,
    build_review_report: BuildReviewReportFn,
    emit_draft_preview: EmitDraftPreviewFn,
    has_blocking_issues: HasBlockingIssuesFn,
) -> list:
    """Run the review-fix-re-evaluate loop.

    Parameters
    ----------
    review_report:
        The initial ``ReviewReport`` produced by ``_build_review_report``.
    section_drafts:
        Current section draft list (mutated in-place by fix iterations).
    blueprint / brief / asset_map:
        Domain objects required by fix and re-evaluate calls.
    thread_id / page_id:
        Identifiers forwarded to downstream tools.
    messages:
        Locale-specific strings (the *only* difference between L2 and L3).
    await_user_input / build_review_report / emit_draft_preview:
        Bound methods from the ``OrchestratorEngine`` instance.
    has_blocking_issues:
        Module-level helper (``_has_blocking_review_issues``).

    Returns
    -------
    list
        The (possibly updated) ``section_drafts`` after zero or more fix
        rounds.
    """

    while review_report.user_decision_needed:
        review_response = await await_user_input(
            thread_id=thread_id,
            phase="review",
            data={
                "type": "review",
                "report": review_report.model_dump(),
            },
            timeout_message=messages.timeout_message,
            raise_on_timeout=False,
        )

        # -- Timeout path --------------------------------------------------
        if not isinstance(review_response, dict):
            if has_blocking_issues(review_report):
                raise RuntimeError(messages.timeout_blocking_error)
            break

        skip_requested = bool(review_response.get("skip"))
        selected_ids = [
            issue_id
            for issue_id in review_response.get("selected_issue_ids", [])
            if isinstance(issue_id, str)
        ]
        feedback = review_response.get("feedback")

        # -- Skip requested but blocking issues remain ---------------------
        if skip_requested and has_blocking_issues(review_report, allow_visual_skip=True):
            blocked_event = {
                "type": "blocked",
                "kind": "review",
                "message": "Blocking review issues remain and must be fixed before completion",
                "required_action": "Fix the remaining blocking issues before completing",
                "allowed_resolutions": [
                    "fix_selected_issues",
                    "update_brief",
                    "update_blueprint",
                ],
            }
            session_store.upsert_session(
                session_id=thread_id,
                thread_id=thread_id,
                run_state="blocked",
                phase="review",
                blocked={k: v for k, v in blocked_event.items() if k != "type"},
            )
            await emit(thread_id, blocked_event)
            continue

        # -- No selection and no skip – nudge user -------------------------
        if not selected_ids and not skip_requested:
            blocked_event = {
                "type": "blocked",
                "kind": "review",
                "message": "Select one or more review issues to fix before continuing",
                "required_action": "Choose review issues to fix, or skip visual issues explicitly",
                "allowed_resolutions": ["fix_selected_issues", "skip_visual_issues"],
            }
            session_store.upsert_session(
                session_id=thread_id,
                thread_id=thread_id,
                run_state="blocked",
                phase="review",
                blocked={k: v for k, v in blocked_event.items() if k != "type"},
            )
            await emit(thread_id, blocked_event)
            continue

        # -- Skip with no remaining blocking issues → exit loop ------------
        if skip_requested:
            if has_blocking_issues(review_report, allow_visual_skip=True):
                await emit(
                    thread_id,
                    {
                        "type": "blocked",
                        "message": messages.skip_blocked_message,
                    },
                )
                continue
            break

        # -- No issues selected (edge case after above guards) -------------
        if not selected_ids:
            await emit(
                thread_id,
                {
                    "type": "blocked",
                    "message": messages.no_selection_message,
                },
            )
            continue

        # -- Fix selected issues and re-evaluate --------------------------
        section_drafts = await fix_selected_issues(
            drafts=section_drafts,
            issues=review_report.issues,
            selected_issue_ids=selected_ids,
            blueprint=blueprint,
            asset_map=asset_map,
            page_id=page_id,
            thread_id=thread_id,
            feedback=feedback if isinstance(feedback, str) else None,
        )
        await emit_draft_preview(
            thread_id=thread_id,
            blueprint=blueprint,
            section_drafts=section_drafts,
        )
        review_report, section_drafts = await build_review_report(
            section_drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=thread_id,
        )

    return section_drafts
