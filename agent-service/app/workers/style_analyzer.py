"""Style Analyzer — learns writing patterns from workspace documents.

Reads recent pages from the workspace and extracts:
- Average paragraph length
- Heading style (noun phrases vs questions vs how-to)
- Formality level
- Common terminology
- Produces a style_guide string for SectionWriter prompts
"""
from __future__ import annotations
import re
from app.utils.text import count_words


def analyze_paragraph_lengths(text: str) -> dict:
    """Analyze paragraph length distribution."""
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    if not paragraphs:
        return {"avg": 0, "short": 0, "long": 0}

    lengths = [count_words(p) for p in paragraphs]
    avg = sum(lengths) / len(lengths) if lengths else 0
    short = sum(1 for l in lengths if l < 30)
    long = sum(1 for l in lengths if l > 100)
    return {"avg": round(avg), "short": short, "long": long, "total": len(paragraphs)}


def analyze_heading_style(text: str) -> str:
    """Classify heading style."""
    headings = re.findall(r'^#{1,6}\s+(.+)$', text, re.MULTILINE)
    if not headings:
        return "unknown"

    questions = sum(1 for h in headings if h.strip().endswith('?') or h.strip().endswith('？'))
    howto = sum(1 for h in headings if h.lower().startswith(('how to', '如何', '怎样')))

    if questions > len(headings) * 0.3:
        return "question-based"
    if howto > len(headings) * 0.3:
        return "how-to"
    return "noun-phrase"


def analyze_formality(text: str) -> str:
    """Estimate formality level."""
    informal_markers = ['哈哈', '嗯', '呢', '啊', '吧', 'lol', 'btw', 'ok']
    formal_markers = ['因此', '综上', '鉴于', '据此', 'therefore', 'consequently', 'furthermore']

    text_lower = text.lower()
    informal_count = sum(1 for m in informal_markers if m in text_lower)
    formal_count = sum(1 for m in formal_markers if m in text_lower)

    if formal_count > informal_count * 2:
        return "formal"
    if informal_count > formal_count * 2:
        return "casual"
    return "neutral"


def extract_common_terms(text: str, min_count: int = 3) -> list[str]:
    """Extract frequently used domain terms."""
    # Find quoted terms and capitalized phrases
    quoted = re.findall(r'[""「」]([^""「」]{2,20})[""「」]', text)
    # Count occurrences
    term_counts: dict[str, int] = {}
    for term in quoted:
        key = term.strip().lower()
        term_counts[key] = term_counts.get(key, 0) + 1

    return [term for term, count in sorted(term_counts.items(), key=lambda x: -x[1]) if count >= min_count][:10]


def generate_style_guide(texts: list[str]) -> str:
    """Generate a style guide from multiple document texts.

    Returns a concise string that can be injected into SectionWriter prompts.
    """
    if not texts:
        return ""

    combined = "\n\n".join(texts)

    para_info = analyze_paragraph_lengths(combined)
    heading_style = analyze_heading_style(combined)
    formality = analyze_formality(combined)
    terms = extract_common_terms(combined)

    parts = []
    parts.append(f"Writing style guide (learned from workspace):")
    parts.append(f"- Average paragraph: ~{para_info['avg']} words")
    parts.append(f"- Heading style: {heading_style}")
    parts.append(f"- Formality: {formality}")
    if terms:
        parts.append(f"- Common terms: {', '.join(terms[:5])}")

    return "\n".join(parts)
