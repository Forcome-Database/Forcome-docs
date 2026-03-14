"""Tests for user interaction pause/resume mechanism."""
from __future__ import annotations

import asyncio

import pytest

from app.orchestrator.tools.user_interaction import (
    InteractionPhase,
    InteractionRegistry,
    interaction_registry,
)


# ---------------------------------------------------------------------------
# InteractionPhase enum
# ---------------------------------------------------------------------------

class TestInteractionPhase:
    def test_phase_values(self):
        assert InteractionPhase.BRIEF == "brief"
        assert InteractionPhase.BLUEPRINT == "blueprint"
        assert InteractionPhase.REVIEW == "review"

    def test_is_str_enum(self):
        assert isinstance(InteractionPhase.BRIEF, str)


# ---------------------------------------------------------------------------
# InteractionRegistry basics
# ---------------------------------------------------------------------------

class TestInteractionRegistryRegister:
    def test_register_creates_entry(self):
        registry = InteractionRegistry()
        registry.register("thread-1")
        assert registry.is_waiting("thread-1")

    def test_is_waiting_false_for_unknown(self):
        registry = InteractionRegistry()
        assert not registry.is_waiting("nonexistent")

    def test_register_replaces_existing(self):
        """Re-registering the same thread replaces the old event."""
        registry = InteractionRegistry()
        registry.register("thread-1")
        # Manually resolve the first event
        registry.submit_response("thread-1", "old")
        # Re-register — should create a fresh, unset event
        registry.register("thread-1")
        assert registry.is_waiting("thread-1")


# ---------------------------------------------------------------------------
# wait_for_response and submit_response flow
# ---------------------------------------------------------------------------

class TestInteractionFlow:
    @pytest.mark.asyncio
    async def test_wait_receives_submitted_response(self):
        registry = InteractionRegistry()
        registry.register("thread-a")

        async def responder():
            await asyncio.sleep(0)  # yield control
            registry.submit_response("thread-a", {"answer": "yes"})

        asyncio.create_task(responder())
        result = await registry.wait_for_response("thread-a")
        assert result == {"answer": "yes"}

    @pytest.mark.asyncio
    async def test_submit_returns_true_when_registered(self):
        registry = InteractionRegistry()
        registry.register("thread-b")
        result = registry.submit_response("thread-b", "data")
        assert result is True

    @pytest.mark.asyncio
    async def test_submit_returns_false_for_unknown_thread(self):
        registry = InteractionRegistry()
        result = registry.submit_response("nonexistent", "data")
        assert result is False

    @pytest.mark.asyncio
    async def test_wait_raises_for_unregistered_thread(self):
        registry = InteractionRegistry()
        with pytest.raises(KeyError, match="not registered"):
            await registry.wait_for_response("ghost-thread")

    @pytest.mark.asyncio
    async def test_wait_receives_none_response(self):
        """Submitting None is valid (e.g. user dismissed the dialog)."""
        registry = InteractionRegistry()
        registry.register("thread-c")
        registry.submit_response("thread-c", None)
        result = await registry.wait_for_response("thread-c")
        assert result is None

    @pytest.mark.asyncio
    async def test_wait_receives_string_response(self):
        registry = InteractionRegistry()
        registry.register("thread-d")
        registry.submit_response("thread-d", "user approved")
        result = await registry.wait_for_response("thread-d")
        assert result == "user approved"


# ---------------------------------------------------------------------------
# is_waiting state transitions
# ---------------------------------------------------------------------------

class TestIsWaiting:
    def test_is_waiting_true_after_register(self):
        registry = InteractionRegistry()
        registry.register("t1")
        assert registry.is_waiting("t1")

    def test_is_waiting_false_after_submit(self):
        registry = InteractionRegistry()
        registry.register("t2")
        registry.submit_response("t2", "response")
        assert not registry.is_waiting("t2")

    def test_is_waiting_false_after_cleanup(self):
        registry = InteractionRegistry()
        registry.register("t3")
        registry.cleanup("t3")
        assert not registry.is_waiting("t3")


# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

class TestCleanup:
    def test_cleanup_removes_event(self):
        registry = InteractionRegistry()
        registry.register("thread-x")
        registry.cleanup("thread-x")
        assert not registry.is_waiting("thread-x")

    def test_cleanup_idempotent(self):
        """Calling cleanup multiple times should not raise."""
        registry = InteractionRegistry()
        registry.register("thread-y")
        registry.cleanup("thread-y")
        registry.cleanup("thread-y")  # should not raise

    def test_cleanup_on_unregistered_thread(self):
        """Cleanup on unknown thread should not raise."""
        registry = InteractionRegistry()
        registry.cleanup("never-registered")  # should not raise

    @pytest.mark.asyncio
    async def test_cleanup_removes_response(self):
        registry = InteractionRegistry()
        registry.register("thread-z")
        registry.submit_response("thread-z", "keep this")
        registry.cleanup("thread-z")
        # After cleanup, re-registering should have no stale response
        registry.register("thread-z")
        # Submit a new response
        registry.submit_response("thread-z", "new data")
        result = await registry.wait_for_response("thread-z")
        assert result == "new data"


# ---------------------------------------------------------------------------
# Timeout behaviour
# ---------------------------------------------------------------------------

class TestTimeout:
    @pytest.mark.asyncio
    async def test_wait_times_out_if_no_response(self):
        """wait_for_response should remain blocked; asyncio.timeout unblocks it."""
        registry = InteractionRegistry()
        registry.register("thread-timeout")
        with pytest.raises(asyncio.TimeoutError):
            async with asyncio.timeout(0.05):
                await registry.wait_for_response("thread-timeout")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

class TestSingleton:
    def test_singleton_exists(self):
        assert interaction_registry is not None
        assert isinstance(interaction_registry, InteractionRegistry)

    def test_singleton_is_shared(self):
        from app.orchestrator.tools.user_interaction import interaction_registry as ir2
        assert interaction_registry is ir2
