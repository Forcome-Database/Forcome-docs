from app.tools.nanobana_imggen import (
    build_nanobana_chat_url,
    extract_nanobana_image_data,
)


def test_build_nanobana_chat_url_normalizes_forcome_v1beta_to_v1():
    assert (
        build_nanobana_chat_url("https://api.forcome.com/v1beta")
        == "https://api.forcome.com/v1/chat/completions"
    )


def test_build_nanobana_chat_url_keeps_standard_openai_compatible_base_urls():
    assert (
        build_nanobana_chat_url("https://example.com/v1")
        == "https://example.com/v1/chat/completions"
    )


def test_extract_nanobana_image_data_reads_markdown_wrapped_data_uri():
    assert (
        extract_nanobana_image_data(
            "![image](data:image/jpeg;base64,abc123XYZ=)"
        )
        == "abc123XYZ="
    )
