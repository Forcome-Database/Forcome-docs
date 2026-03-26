"""Agent 输出后验证器。

验证 Agent 生成的 Markdown 是否满足质量要求：
1. 所有上传的图片 URL 必须出现在输出中
2. 输出不能为空或过短
3. 不能包含 OCR 噪音特征
4. 标题层级检查（H1 最多 1 个）
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    """验证结果。"""
    passed: bool
    issues: list[str] = field(default_factory=list)


def validate_agent_output(
    output: str,
    uploaded_image_urls: dict[str, str],
    min_length: int = 100,
) -> ValidationResult:
    """验证 Agent 输出的质量。

    Args:
        output: Agent 生成的 Markdown 文本。
        uploaded_image_urls: extract_document 上传的图片 URL 映射
            格式: {"原始引用": "Docmost 完整 URL"}。
        min_length: 输出最小字符数（默认 100）。

    Returns:
        ValidationResult，passed=True 表示通过，issues 列出具体问题。
    """
    issues: list[str] = []

    # 检查 1: 输出不能为空或过短
    if len(output.strip()) < min_length:
        issues.append(
            f"Output too short: {len(output.strip())} chars (minimum {min_length})"
        )

    # 检查 2: 所有上传的图片 URL 必须出现在输出中
    for ref, url in uploaded_image_urls.items():
        if url not in output:
            issues.append(f"Missing image URL: {ref} → {url}")

    # 检查 3: OCR 噪音检测（UI 菜单文字泄漏）
    ocr_noise_patterns = [
        "自 日志",
        "? 帮助",
        "A 关于",
        "设置\n?",
    ]
    for pattern in ocr_noise_patterns:
        if pattern in output:
            issues.append(f"Possible OCR noise detected: '{pattern}'")

    # 检查 4: 标题层级（H1 最多 1 个）
    lines = output.split("\n")
    h1_count = sum(1 for line in lines if line.startswith("# ") or line == "#")
    if h1_count > 1:
        issues.append(f"Multiple H1 headings found: {h1_count} (maximum 1)")

    return ValidationResult(
        passed=len(issues) == 0,
        issues=issues,
    )
