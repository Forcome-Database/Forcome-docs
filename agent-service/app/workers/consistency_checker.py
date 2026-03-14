"""Cross-section consistency checker.

Validates coherence across all sections after writing is complete.
Produces a list of consistency issues (added to ReviewReport later).
"""
from __future__ import annotations
import re
from app.models.draft import SectionDraft
from app.models.blueprint import CreationBlueprint


class ConsistencyIssue:
    def __init__(self, section_id: str | None, category: str, description: str):
        self.section_id = section_id
        self.category = category
        self.description = description

    def to_dict(self) -> dict:
        return {"section_id": self.section_id, "category": self.category, "description": self.description}


def check_heading_continuity(drafts: list[SectionDraft], blueprint: CreationBlueprint) -> list[ConsistencyIssue]:
    """Check heading numbering/level continuity."""
    issues = []
    for i, (draft, section) in enumerate(zip(drafts, blueprint.sections)):
        # Check for heading level inconsistency within section content
        headings = re.findall(r'^(#{1,6})\s', draft.content, re.MULTILINE)
        for h in headings:
            h_level = len(h)
            if h_level <= section.level:
                issues.append(ConsistencyIssue(
                    section_id=draft.section_id,
                    category="heading_level",
                    description=f"Section '{section.title}' contains H{h_level} heading, but section itself is H{section.level}. Sub-headings should be H{section.level + 1} or deeper.",
                ))
                break
    return issues


def check_term_consistency(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check for inconsistent terminology across sections.

    Detects common patterns like using different names for the same concept.
    """
    issues = []
    # Collect all terms used (simple heuristic: capitalized multi-word phrases)
    all_terms: dict[str, set[str]] = {}  # normalized → {variants}
    for draft in drafts:
        # Find quoted terms or capitalized phrases
        quoted = re.findall(r'["\u201c\u201d\u300c\u300d]([^"\u201c\u201d\u300c\u300d]+)["\u201c\u201d\u300c\u300d]', draft.content)
        for term in quoted:
            normalized = term.lower().strip()
            if normalized not in all_terms:
                all_terms[normalized] = set()
            all_terms[normalized].add(term.strip())

    # Flag terms with multiple variants
    for normalized, variants in all_terms.items():
        if len(variants) > 1 and len(normalized) > 2:
            issues.append(ConsistencyIssue(
                section_id=None,
                category="term_inconsistency",
                description=f"Inconsistent term usage: {', '.join(sorted(variants))}",
            ))

    return issues


def check_cross_references(drafts: list[SectionDraft], blueprint: CreationBlueprint) -> list[ConsistencyIssue]:
    """Check cross-references between sections (e.g., '如第3章所述')."""
    issues = []
    section_titles = {s.title.lower() for s in blueprint.sections}

    for draft in drafts:
        # Chinese cross-reference patterns
        refs = re.findall(r'(?:\u5982|\u89c1|\u53c2\u89c1|\u8be6\u89c1)[「"]?\u7b2c?\s*(\d+)\s*[\u7ae0\u8282\u90e8\u5206]', draft.content)
        refs += re.findall(r'(?:as mentioned in|see|refer to)\s+(?:section|chapter)\s+(\d+)', draft.content, re.IGNORECASE)

        for ref_num in refs:
            num = int(ref_num)
            if num > len(blueprint.sections) or num < 1:
                issues.append(ConsistencyIssue(
                    section_id=draft.section_id,
                    category="cross_reference",
                    description=f"References section/chapter {num}, but document only has {len(blueprint.sections)} sections.",
                ))

    return issues


def check_empty_sections(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check for empty or nearly empty sections."""
    issues = []
    for draft in drafts:
        if not draft.content or len(draft.content.strip()) < 50:
            issues.append(ConsistencyIssue(
                section_id=draft.section_id,
                category="empty_section",
                description=f"Section is empty or has minimal content ({len(draft.content.strip())} chars).",
            ))
    return issues


def run_consistency_checks(
    drafts: list[SectionDraft],
    blueprint: CreationBlueprint,
) -> list[ConsistencyIssue]:
    """Run all consistency checks and return combined issues."""
    issues = []
    issues.extend(check_heading_continuity(drafts, blueprint))
    issues.extend(check_term_consistency(drafts))
    issues.extend(check_cross_references(drafts, blueprint))
    issues.extend(check_empty_sections(drafts))
    return issues
