from app.agent.nodes.writer import (
    _build_length_instruction,
    _strip_empty_images,
    WRITER_SYSTEM_PROMPT,
)


def test_strip_empty_images_removes_placeholder_hosted_images():
    draft = (
        "## UI Mockup\n\n"
        "![UI Interaction States Mockup]"
        "(https://via.placeholder.com/800x400?text=UI+Interaction+States+Mockup)"
    )

    assert _strip_empty_images(draft) == "## UI Mockup\n\n> *UI Interaction States Mockup*"


def test_strip_empty_images_preserves_uploaded_docmost_images():
    draft = "![Generated Mockup](/api/files/file-1/generated-mockup.png)"

    assert draft == _strip_empty_images(draft)


def test_build_length_instruction_preserve_with_source():
    result = _build_length_instruction("preserve", source_word_count=5000)
    assert "5000" in result
    assert "偏差" in result


def test_build_length_instruction_preserve_no_source():
    result = _build_length_instruction("preserve", source_word_count=0)
    assert result == ""


def test_build_length_instruction_expand():
    result = _build_length_instruction("expand", source_word_count=3000)
    assert "4500" in result


def test_build_length_instruction_compress():
    result = _build_length_instruction("compress", source_word_count=3000)
    assert result == ""


def test_writer_prompt_contains_anti_ai_instructions():
    assert "套路" in WRITER_SYSTEM_PROMPT


def test_writer_prompt_contains_chinese_output_instruction():
    assert "中文" in WRITER_SYSTEM_PROMPT
