"""测试 Agent 输出后验证器。"""
from app.agent.validator import validate_agent_output, ValidationResult


def test_pass_when_all_images_present():
    """所有图片 URL 都在输出中 → 通过。"""
    output = (
        "# 文档标题\n\n"
        "这是文档内容。\n\n"
        "![图片1](http://example.com/a.jpg)\n\n"
        "更多内容在这里，足够长。这是一份详细的文档，需要包含足够的信息来通过最小长度检查。\n"
        "![图片2](http://example.com/b.jpg)\n"
    )
    urls = {"a": "http://example.com/a.jpg", "b": "http://example.com/b.jpg"}
    result = validate_agent_output(output, urls)
    assert result.passed
    assert result.issues == []


def test_fail_when_image_missing():
    """有图片 URL 未在输出中出现 → 失败，issues 包含缺失 URL。"""
    output = "# 文档标题\n\n![图片1](http://example.com/a.jpg)\n\n足够长的内容，用于通过最短长度检查。"
    urls = {"a": "http://example.com/a.jpg", "b": "http://example.com/b.jpg"}
    result = validate_agent_output(output, urls)
    assert not result.passed
    assert any("b.jpg" in issue for issue in result.issues)


def test_fail_when_output_too_short():
    """输出过短 → 失败。"""
    result = validate_agent_output("short", {})
    assert not result.passed
    assert any("too short" in issue.lower() for issue in result.issues)


def test_pass_with_no_images():
    """无图片 URLs → 只检查其他规则，内容够长即通过。"""
    output = "# 文档标题\n\n" + "这是足够长的文档内容。" * 10
    result = validate_agent_output(output, {})
    assert result.passed


def test_detect_ocr_noise():
    """检测 OCR 噪音特征。"""
    # 足够长 + 含 OCR 噪音
    output = "# 文档标题\n\n" + "x" * 200 + "\n自 日志\n设置"
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("OCR" in issue for issue in result.issues)


def test_detect_multiple_h1():
    """多个 H1 标题 → 失败。"""
    output = "# 标题一\n\n内容一，足够长。" + "x" * 50 + "\n\n# 标题二\n\n内容二更多。"
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("H1" in issue for issue in result.issues)


def test_pass_single_h1():
    """只有一个 H1 标题 → 通过（不触发 H1 规则）。"""
    output = "# 唯一标题\n\n## 子标题\n\n" + "足够长的内容内容内容。" * 10
    result = validate_agent_output(output, {})
    assert result.passed


def test_multiple_issues_reported():
    """多个问题应同时报告。"""
    # 过短 + 图片缺失
    output = "too short"
    urls = {"img": "http://example.com/img.jpg"}
    result = validate_agent_output(output, urls)
    assert not result.passed
    assert len(result.issues) >= 2


def test_custom_min_length():
    """自定义最小长度。"""
    output = "exactly fifty characters long content here!!"
    result = validate_agent_output(output, {}, min_length=10)
    assert result.passed

    result2 = validate_agent_output(output, {}, min_length=200)
    assert not result2.passed
