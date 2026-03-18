"""Evaluator Worker — quality assessment without LLM rewriting.

Two-pass evaluation:
1. Deterministic checks (code-based, no LLM)
2. LLM quality assessment (evaluation only, no rewriting)
"""
from __future__ import annotations
import re
import uuid
from app.models.draft import SectionDraft
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.asset_map import AssetMap
from app.models.brief import CreationBrief
from app.models.review import ReviewIssue, ReviewReport
from app.utils.text import count_words


def _make_issue_id() -> str:
    return f"issue-{uuid.uuid4().hex[:8]}"


def check_word_budgets(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
    tolerance: float = 0.1,
) -> list[ReviewIssue]:
    """Check each section's word count against its budget."""
    issues = []
    for draft, section in zip(drafts, blueprint.sections):
        if section.word_budget <= 0:
            continue
        actual = draft.word_count or count_words(draft.content)
        budget = section.word_budget
        ratio = actual / budget if budget > 0 else 1.0
        if ratio < (1 - tolerance):
            issues.append(ReviewIssue(
                id=_make_issue_id(),
                section_id=draft.section_id,
                severity="warning",
                category="length",
                description=f"章节'{section.title}'字数不足：实际 {actual} 字，预算 {budget} 字（{ratio:.0%}）",
                suggestion=f"建议扩展内容至约 {budget} 字",
                auto_fixable=False,
            ))
        elif ratio > (1 + tolerance):
            issues.append(ReviewIssue(
                id=_make_issue_id(),
                section_id=draft.section_id,
                severity="info",
                category="length",
                description=f"章节'{section.title}'字数超出：实际 {actual} 字，预算 {budget} 字（{ratio:.0%}）",
                suggestion=f"可考虑精简至约 {budget} 字",
                auto_fixable=False,
            ))
    return issues


def check_asset_coverage(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
    asset_map: AssetMap | None,
) -> list[ReviewIssue]:
    """Check if planned assets were actually used."""
    if not asset_map:
        return []
    issues = []
    used_asset_ids = set()
    for draft in drafts:
        used_asset_ids.update(draft.assets_used)

    planned_ids = set()
    for section in blueprint.sections:
        planned_ids.update(section.assets)

    unused = planned_ids - used_asset_ids
    available_ids = {item.id for item in asset_map.items}
    unused = unused & available_ids  # Only flag assets that actually exist

    for asset_id in unused:
        item = next((i for i in asset_map.items if i.id == asset_id), None)
        if item:
            issues.append(ReviewIssue(
                id=_make_issue_id(),
                section_id=None,
                severity="warning",
                category="asset",
                description=f"素材'{item.id}'({item.type})未被引用",
                suggestion=f"建议在相关章节中引用此素材：{item.summary[:50]}",
                auto_fixable=False,
            ))
    return issues


def check_visual_coverage(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
) -> list[ReviewIssue]:
    """Check whether planned visuals were actually realized in the section output."""
    issues: list[ReviewIssue] = []
    for draft, section in zip(drafts, blueprint.sections):
        if not section.visuals:
            continue

        has_image_markdown = bool(re.search(r'!\[[^\]]*\]\(([^)]+)\)', draft.content))
        has_mermaid = "```mermaid" in draft.content
        has_table = "|" in draft.content and "\n|" in draft.content

        for visual in section.visuals:
            if visual.type == "ai_image" and not has_image_markdown:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="error",
                    category="visual",
                    description=f"章节'{section.title}'计划生成图片，但正文中未落图",
                    suggestion=f"为该章节生成并插入图片：{visual.description}",
                    auto_fixable=False,
                ))
            elif visual.type == "reuse_image" and not has_image_markdown:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="warning",
                    category="visual",
                    description=f"章节'{section.title}'计划复用图片，但正文中未插入图片",
                    suggestion=f"插入计划图片：{visual.description}",
                    auto_fixable=False,
                ))
            elif visual.type == "mermaid" and not has_mermaid:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="warning",
                    category="visual",
                    description=f"章节'{section.title}'计划包含 Mermaid 图，但正文中未生成",
                    suggestion=f"补充 Mermaid 图：{visual.description}",
                    auto_fixable=False,
                ))
            elif visual.type == "table" and not has_table:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="warning",
                    category="visual",
                    description=f"章节'{section.title}'计划包含表格，但正文中未生成",
                    suggestion=f"补充表格：{visual.description}",
                    auto_fixable=False,
                ))
    return issues


def check_heading_levels(drafts: list[SectionDraft], blueprint: CreationBlueprint) -> list[ReviewIssue]:
    """Check heading level consistency within sections."""
    issues = []
    for draft, section in zip(drafts, blueprint.sections):
        headings = re.findall(r'^(#{1,6})\s', draft.content, re.MULTILINE)
        for h in headings:
            h_level = len(h)
            if h_level <= section.level:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="warning",
                    category="format",
                    description=f"章节'{section.title}'中包含 H{h_level} 标题，但该章节本身是 H{section.level}",
                    suggestion=f"子标题应使用 H{section.level + 1} 或更深层级",
                    auto_fixable=True,
                ))
                break
    return issues


def check_mermaid_syntax(drafts: list[SectionDraft]) -> list[ReviewIssue]:
    """Basic Mermaid syntax validation."""
    issues = []
    for draft in drafts:
        mermaid_blocks = re.findall(r'```mermaid\n(.*?)```', draft.content, re.DOTALL)
        for block in mermaid_blocks:
            stripped = block.strip()
            if not stripped:
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="error",
                    category="format",
                    description="空的 Mermaid 代码块",
                    suggestion="移除空 Mermaid 块或添加图表内容",
                    auto_fixable=True,
                ))
            # Check for common diagram type declarations
            elif not re.match(r'^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)', stripped):
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="warning",
                    category="format",
                    description="Mermaid 代码块缺少图表类型声明",
                    suggestion="添加 graph TD, flowchart LR, sequenceDiagram 等声明",
                    auto_fixable=False,
                ))
    return issues


def check_image_urls(drafts: list[SectionDraft]) -> list[ReviewIssue]:
    """Check for broken/placeholder image URLs."""
    issues = []
    placeholder_patterns = [
        r'placehold\.co', r'placeholder\.com', r'dummyimage\.com',
        r'via\.placeholder', r'example\.com/img',
    ]
    for draft in drafts:
        images = re.findall(r'!\[([^\]]*)\]\(([^)]+)\)', draft.content)
        for alt, url in images:
            if not url.startswith(('http://', 'https://')):
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="error",
                    category="visual",
                    description=f"无效图片链接: {url[:50]}",
                    suggestion="移除或替换为有效的图片 URL",
                    auto_fixable=True,
                ))
            elif any(re.search(p, url) for p in placeholder_patterns):
                issues.append(ReviewIssue(
                    id=_make_issue_id(),
                    section_id=draft.section_id,
                    severity="error",
                    category="visual",
                    description=f"占位符图片链接: {url[:50]}",
                    suggestion="替换为真实图片",
                    auto_fixable=True,
                ))
    return issues


def check_empty_sections(drafts: list[SectionDraft]) -> list[ReviewIssue]:
    """Check for empty or nearly empty sections."""
    issues = []
    for draft in drafts:
        if not draft.content or len(draft.content.strip()) < 50:
            issues.append(ReviewIssue(
                id=_make_issue_id(),
                section_id=draft.section_id,
                severity="error",
                category="structure",
                description=f"章节内容过少（{len(draft.content.strip())} 字符）",
                suggestion="补充实质性内容",
                auto_fixable=False,
            ))
    return issues


def evaluate_deterministic(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
) -> list[ReviewIssue]:
    """Run all deterministic quality checks."""
    issues = []
    issues.extend(check_word_budgets(drafts, blueprint, brief.length_tolerance))
    issues.extend(check_asset_coverage(drafts, blueprint, asset_map))
    issues.extend(check_visual_coverage(drafts, blueprint))
    issues.extend(check_heading_levels(drafts, blueprint))
    issues.extend(check_mermaid_syntax(drafts))
    issues.extend(check_image_urls(drafts))
    issues.extend(check_empty_sections(drafts))
    return issues


EVALUATOR_LLM_PROMPT = """You are a document quality evaluator. You evaluate documents — you do NOT rewrite them.

Output ONLY a JSON object with:
- overall_score: 0-100 quality score
- issues: array of specific issues found

Evaluation dimensions:
1. Accuracy: Are claims supported? Any factual errors?
2. Completeness: Are all required topics covered?
3. Style consistency: Is the tone consistent throughout?
4. Readability: Is it well-organized and easy to follow?
5. Argument strength: Are arguments well-supported?

IMPORTANT: Do NOT output any revised content. Only evaluate and list issues."""


async def evaluate_with_llm(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    thread_id: str = "",
) -> tuple[int, list[ReviewIssue]]:
    """LLM-based quality evaluation (evaluation only, NO rewriting).

    Returns (overall_score, issues).
    """
    import json
    from pydantic_ai import Agent
    from app.orchestrator.llm_factory import create_pydantic_ai_model
    from app.agent.events import emit

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt=EVALUATOR_LLM_PROMPT)

    # Build evaluation context
    draft_text = "\n\n---\n\n".join(
        f"## {s.title}\n\n{d.content}"
        for s, d in zip(blueprint.sections, drafts)
    )

    prompt = f"""Evaluate this document against the creation blueprint.

Blueprint: {blueprint.title}
Target audience: {brief.audience}
Style: {brief.style}
Target length: {brief.target_length} 字/words (each Chinese character = 1, each English word = 1)

Document:
{draft_text[:8000]}

Output JSON only:
{{"overall_score": 0-100, "issues": [{{"section_title": "exact section title from the outline above", "severity": "warning|error|info", "category": "content|style|structure", "description": "...", "suggestion": "..."}}]}}

IMPORTANT: For each issue, set "section_title" to the EXACT title of the relevant section from the outline. If an issue is global (not specific to one section), set "section_title" to null."""

    await emit(thread_id, {"type": "step_start", "step": "llm_evaluation", "description": "AI 质量评估"})

    result = await agent.run(prompt)
    text = result.data if hasattr(result, 'data') else str(result)

    # Parse JSON from response
    try:
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
        else:
            parsed = {"overall_score": 70, "issues": []}
    except json.JSONDecodeError:
        parsed = {"overall_score": 70, "issues": []}

    overall_score = parsed.get("overall_score", 70)
    llm_issues = []

    # Build title → section_id lookup for mapping LLM results
    title_to_id: dict[str, str] = {}
    for section in blueprint.sections:
        title_to_id[section.title.lower().strip()] = section.id

    for issue_data in parsed.get("issues", []):
        # Map section_title to section_id
        section_title = issue_data.get("section_title") or ""
        section_id = title_to_id.get(section_title.lower().strip()) if section_title else None

        llm_issues.append(ReviewIssue(
            id=_make_issue_id(),
            section_id=section_id,
            severity=issue_data.get("severity", "warning"),
            category=issue_data.get("category", "content"),
            description=issue_data.get("description", ""),
            suggestion=issue_data.get("suggestion", ""),
            auto_fixable=False,
        ))

    await emit(thread_id, {"type": "step_done", "step": "llm_evaluation", "result_summary": f"Score: {overall_score}/100, {len(llm_issues)} issues"})

    return overall_score, llm_issues
