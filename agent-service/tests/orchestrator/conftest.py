"""Shared fixtures for orchestrator tests."""
from __future__ import annotations

import pytest

from app.orchestrator.tools.parse_assets import clear_asset_cache


@pytest.fixture(autouse=True)
def reset_asset_cache():
    """Clear the parse_assets in-memory cache before each test."""
    clear_asset_cache()
    yield
    clear_asset_cache()
