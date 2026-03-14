from __future__ import annotations
import re


def count_words(text: str) -> int:
    """Count words with Chinese awareness.

    Chinese characters count as 1 word each.
    Non-Chinese text is counted by whitespace splitting.
    Punctuation and whitespace are not counted.
    """
    if not text:
        return 0
    # Count Chinese characters (CJK Unified Ideographs + Extension A)
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text))
    # Remove Chinese characters and CJK/fullwidth punctuation to count remaining (English/other) words
    non_chinese = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf]', ' ', text)
    # Remove CJK punctuation, fullwidth punctuation and other non-word characters
    non_chinese = re.sub(r'[\u3000-\u303f\uff00-\uffef\u2000-\u206f]', ' ', non_chinese)
    # Split by whitespace and filter tokens that contain at least one alphanumeric character
    english_words = len([w for w in non_chinese.split() if re.search(r'\w', w)])
    return chinese_chars + english_words


def count_words_by_section(text: str) -> dict[str, int]:
    """Split text by markdown headings and count words per section."""
    sections: dict[str, int] = {}
    current_heading = "(untitled)"
    current_content: list[str] = []

    for line in text.split('\n'):
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading_match:
            if current_content:
                sections[current_heading] = count_words('\n'.join(current_content))
            current_heading = heading_match.group(2).strip()
            current_content = []
        else:
            current_content.append(line)

    if current_content:
        sections[current_heading] = count_words('\n'.join(current_content))

    return sections
