"""Selective issue repair helpers."""
from __future__ import annotations

from app.agent.events import emit
from app.models.blueprint import CreationBlueprint
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue
from app.utils.text import count_words
from app.workers.fixer import apply_auto_fixes, fix_targeted


async def fix_selected_issues(
    drafts: list[SectionDraft],
    issues: list[ReviewIssue],
    selected_issue_ids: list[str],
    blueprint: CreationBlueprint,
    thread_id: str = "",
    feedback: str | None = None,
) -> list[SectionDraft]:
    """Fix only the user-selected issues."""

    section_levels = {section.id: section.level for section in blueprint.sections}
    auto_fixable_issues = [
        issue
        for issue in issues
        if issue.auto_fixable and not issue.fixed
    ]
    if auto_fixable_issues:
        drafts, auto_count = apply_auto_fixes(drafts, auto_fixable_issues, section_levels)
        for issue in auto_fixable_issues:
            if not issue.fixed:
                continue
            await emit(
                thread_id,
                {
                    "type": "fix_applied",
                    "issue_id": issue.id,
                    "section_id": issue.section_id,
                    "success": True,
                },
            )
            await emit(
                thread_id,
                {
                    "type": "step_done",
                    "step": "fix_issue",
                    "result_summary": f"Fixed: {issue.description[:60]}",
                },
            )

        await emit(
            thread_id,
            {
                "type": "step_done",
                "step": "auto_fix",
                "result_summary": f"Auto-fixed {auto_count} issues",
            },
        )

    selected_manual = [
        issue
        for issue in issues
        if issue.id in selected_issue_ids and not issue.auto_fixable and not issue.fixed
    ]
    for issue in selected_manual:
        if not issue.section_id:
            continue
        draft = next((item for item in drafts if item.section_id == issue.section_id), None)
        if not draft:
            continue

        fixed_content = await fix_targeted(
            section_content=draft.content,
            issue=issue,
            thread_id=thread_id,
            feedback=feedback,
        )
        draft.content = fixed_content
        draft.word_count = count_words(fixed_content)
        issue.fixed = True

        await emit(
            thread_id,
            {
                "type": "fix_applied",
                "issue_id": issue.id,
                "section_id": issue.section_id,
                "success": True,
            },
        )
        await emit(
            thread_id,
            {
                "type": "step_done",
                "step": "fix_issue",
                "result_summary": f"Fixed: {issue.description[:60]}",
            },
        )

    return drafts
