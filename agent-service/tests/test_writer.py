from app.agent.nodes.writer import _strip_empty_images


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
