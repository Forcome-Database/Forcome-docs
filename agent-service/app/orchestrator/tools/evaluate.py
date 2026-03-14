"""Evaluate quality orchestrator tool — combines deterministic + LLM evaluation."""
from __future__ import annotations

from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft
from app.models.review import ReviewReport
from app.workers.evaluator import evaluate_deterministic, evaluate_with_llm


async def evaluate_quality(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    thread_id: str = "",
) -> ReviewReport:
    """Run full quality evaluation: deterministic + LLM.

    Returns a ReviewReport with combined issues, metrics, and score.
    """
    # 1. Deterministic checks (no LLM)
    det_issues = evaluate_deterministic(drafts, blueprint, brief, asset_map)

    # 2. LLM evaluation (evaluation only, no rewriting)
    overall_score, llm_issues = await evaluate_with_llm(drafts, blueprint, brief, thread_id)

    # 3. Merge all issues
    all_issues = det_issues + llm_issues

    # 4. Compute length compliance metric
    total_budget = sum(s.word_budget for s in blueprint.sections)
    total_actual = sum(d.word_count for d in drafts)
    if total_budget > 0:
        length_compliance = 1.0 - abs(total_actual - total_budget) / total_budget
        length_compliance = max(0.0, min(1.0, length_compliance))
    else:
        length_compliance = 1.0

    # 5. Compute asset reuse rate
    used_assets: set[str] = set()
    for d in drafts:
        used_assets.update(d.assets_used)
    planned_assets: set[str] = set()
    for s in blueprint.sections:
        planned_assets.update(s.assets)
    asset_reuse_rate = (
        len(used_assets & planned_assets) / len(planned_assets)
        if planned_assets
        else 1.0
    )

    # 6. Separate auto-fixable from user-decision-needed
    user_needed = [i.id for i in all_issues if not i.auto_fixable and not i.fixed]

    return ReviewReport(
        overall_score=overall_score,
        length_compliance=length_compliance,
        asset_reuse_rate=asset_reuse_rate,
        issues=all_issues,
        auto_fixed_count=0,
        user_decision_needed=user_needed,
    )
