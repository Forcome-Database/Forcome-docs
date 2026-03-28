"""测试增强后的 Agent 输出验证器。"""
from app.agent.validator import validate_agent_output


def test_short_output_detected():
    result = validate_agent_output("Hello", {})
    assert not result.passed
    assert any("too short" in i.lower() for i in result.issues)


def test_missing_image_detected():
    urls = {"image1": "https://docmost/img1.jpg"}
    result = validate_agent_output("# Title\n\nSome content " * 20, urls)
    assert not result.passed
    assert any("image" in i.lower() for i in result.issues)


def test_all_images_present_passes():
    urls = {"image1": "https://docmost/img1.jpg", "image2": "https://docmost/img2.jpg"}
    output = "# Title\n\n![desc](https://docmost/img1.jpg)\n\n![desc](https://docmost/img2.jpg)" + " word" * 50
    result = validate_agent_output(output, urls)
    assert result.passed


def test_multiple_h1_detected():
    output = "# Title 1\n\nContent\n\n# Title 2\n\nMore content" + " word" * 100
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("H1" in i for i in result.issues)


def test_ocr_noise_detected():
    output = "正常内容 " * 50 + "自 日志 设置 ? 帮助 A 关于"
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("OCR" in i for i in result.issues)


def test_compression_ratio_warning():
    output = "Short summary. " * 30  # ~60 words
    result = validate_agent_output(output, {}, source_word_count=3000)
    assert not result.passed
    assert any("compress" in i.lower() for i in result.issues)


def test_normal_output_passes():
    output = "# Good Title\n\n" + "This is normal content with enough depth. " * 50
    result = validate_agent_output(output, {})
    assert result.passed


def test_validation_result_has_score():
    output = "# Title\n\n" + "Good content. " * 100
    result = validate_agent_output(output, {})
    assert hasattr(result, "score")
    assert 0 <= result.score <= 1.0
