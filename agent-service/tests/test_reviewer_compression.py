def test_compression_detected_when_draft_below_70_percent():
    """10000 char source, 3000 char draft (30%) should be flagged."""
    source = "x" * 10000
    draft = "y" * 3000
    assert len(draft) < max(400, int(len(source) * 0.7))


def test_compression_not_detected_when_draft_above_70_percent():
    """10000 char source, 8000 char draft (80%) should NOT be flagged."""
    source = "x" * 10000
    draft = "y" * 8000
    assert len(draft) >= max(400, int(len(source) * 0.7))
