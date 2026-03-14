"""Fix issues orchestrator tool — selective issue repair."""
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
) -> list[SectionDraft]:
    """Fix only the user-selected issues.

    Two-phase repair:
    1. Auto-fix all auto_fixable issues first (deterministic)
    2. LLM-based targeted fix for selected non-auto issues
    """

    # 1. Auto-fix all auto_fixable issues first
    section_levels = {s.id: s.level for s in blueprint.sections}
    auto_fixable = [i for i in issues if i.auto_fixable and not i.fixed]
    if auto_fixable:
        drafts, auto_count = apply_auto_fixes(drafts, issues, section_levels)
        await emit(thread_id, {
            "type": "step_done",
            "step": "auto_fix",
            "result_summary": f"自动修复 {auto_count} 项",
        })

    # 2. LLM fix for selected non-auto issues
    selected = [
        i for i in issues
        if i.id in selected_issue_ids and not i.auto_fixable and not i.fixed
    ]

    for issue in selected:
        if not issue.section_id:
            continue
        draft = next((d for d in drafts if d.section_id == issue.section_id), None)
        if not draft:
            continue

        fixed_content = await fix_targeted(
            section_content=draft.content,
            issue=issue,
            thread_id=thread_id,
        )
        draft.content = fixed_content
        draft.word_count = count_words(fixed_content)
        issue.fixed = True

    return drafts
