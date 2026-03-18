"""Selective issue repair helpers."""
from __future__ import annotations

from collections import defaultdict

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
    manual_by_section: dict[str, list[ReviewIssue]] = defaultdict(list)
    for issue in selected_manual:
        if issue.section_id:
            manual_by_section[issue.section_id].append(issue)

    for section_id, section_issues in manual_by_section.items():
        draft = next((item for item in drafts if item.section_id == section_id), None)
        if not draft:
            continue

        primary_issue = section_issues[0].model_copy(deep=True)
        if len(section_issues) > 1:
            primary_issue.description = "Resolve the following issues in this section:\n" + "\n".join(
                f"- {issue.description}" for issue in section_issues
            )
            primary_issue.suggestion = "\n".join(
                issue.suggestion for issue in section_issues if issue.suggestion
            )

        fixed_content = await fix_targeted(
            section_content=draft.content,
            issue=primary_issue,
            thread_id=thread_id,
            feedback=feedback,
        )
        draft.content = fixed_content
        draft.word_count = count_words(fixed_content)

        for issue in section_issues:
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
