"""Agent 输出后验证器。

验证维度：
1. 输出长度（不能过短）
2. 图片 URL 完整性
3. OCR 噪音检测
4. 标题层级（H1 最多 1 个）
5. 压缩过度检测
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    passed: bool
    score: float  # 0.0 - 1.0
    issues: list[str] = field(default_factory=list)


def validate_agent_output(
    output: str,
    uploaded_image_urls: dict[str, str],
    min_length: int = 100,
    source_word_count: int = 0,
) -> ValidationResult:
    issues: list[str] = []
    deductions = 0.0
    stripped = output.strip()

    # Check 1: Length (weight 0.3)
    if len(stripped) < min_length:
        issues.append(f"Output too short: {len(stripped)} chars (minimum {min_length})")
        deductions += 0.3

    # Check 2: Image URLs (weight 0.05 each)
    for ref, url in uploaded_image_urls.items():
        if url not in output:
            issues.append(f"Missing image: {ref} → {url}")
            deductions += 0.05

    # Check 3: OCR noise (weight 0.1)
    ocr_patterns = ["自 日志", "? 帮助", "A 关于", "设置\n?"]
    for pattern in ocr_patterns:
        if pattern in output:
            issues.append(f"OCR noise detected: '{pattern}'")
            deductions += 0.1
            break

    # Check 4: H1 max 1 (weight 0.1)
    lines = output.split("\n")
    h1_count = sum(1 for line in lines if line.startswith("# ") or line == "#")
    if h1_count > 1:
        issues.append(f"Multiple H1 headings: {h1_count} (maximum 1)")
        deductions += 0.1

    # Check 5: Compression ratio (weight 0.2)
    if source_word_count > 0:
        output_word_count = len(stripped.split())
        ratio = output_word_count / source_word_count
        if source_word_count > 2000 and ratio < 0.25:
            issues.append(
                f"Possible over-compression: {output_word_count} words output "
                f"from {source_word_count} words source (ratio: {ratio:.0%})"
            )
            deductions += 0.2
        elif source_word_count > 1000 and ratio < 0.15:
            issues.append(
                f"Severe compression: {output_word_count} words from "
                f"{source_word_count} words source (ratio: {ratio:.0%})"
            )
            deductions += 0.2

    score = max(0.0, 1.0 - deductions)
    return ValidationResult(passed=len(issues) == 0, score=round(score, 2), issues=issues)
