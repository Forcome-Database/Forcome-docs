"""Tests for SSEOptimizer — content batching, flush behavior, and heartbeat."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, call, patch

import pytest

from app.orchestrator.sse_optimizer import SSEOptimizer


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_optimizer(buffer_ms: int = 10) -> tuple[SSEOptimizer, AsyncMock]:
    """Return (optimizer, mock_raw_emit) with a short buffer for tests."""
    mock_emit = AsyncMock()
    opt = SSEOptimizer(thread_id="test-thread", buffer_ms=buffer_ms)
    return opt, mock_emit


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSSEOptimizerContentBuffering:
    @pytest.mark.asyncio
    async def test_content_chunks_are_buffered_not_emitted_immediately(self):
        """Content events should be held in the buffer, not forwarded at once."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "Hello "})
            # raw_emit should NOT have been called yet
            mock_emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_content_chunks_flushed_as_single_event(self):
        """Multiple content chunks flushed together → one combined event."""
        opt, mock_emit = _make_optimizer(buffer_ms=5)

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "Hello "})
            await opt.emit({"type": "content", "chunk": "World"})
            await opt.flush()

        mock_emit.assert_called_once_with(
            "test-thread", {"type": "content", "chunk": "Hello World"}
        )

    @pytest.mark.asyncio
    async def test_flush_on_non_content_event(self):
        """Receiving a step_start event flushes buffered content first."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "partial"})
            await opt.emit({"type": "step_start", "step": "plan"})

        assert mock_emit.call_count == 2
        # First call: flush accumulated content
        assert mock_emit.call_args_list[0] == call(
            "test-thread", {"type": "content", "chunk": "partial"}
        )
        # Second call: the step_start event itself
        assert mock_emit.call_args_list[1].args[1]["type"] == "step_start"

    @pytest.mark.asyncio
    async def test_step_done_flushes_content_first(self):
        """step_done also triggers a content flush before forwarding."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "abc"})
            await opt.emit({"type": "step_done", "step": "plan"})

        # content flush + step_done
        assert mock_emit.call_count == 2
        types = [c.args[1]["type"] for c in mock_emit.call_args_list]
        assert types == ["content", "step_done"]

    @pytest.mark.asyncio
    async def test_non_content_non_step_event_flushes_and_forwards(self):
        """Any unrecognized event type also triggers a content flush."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "x"})
            await opt.emit({"type": "error", "message": "oops"})

        assert mock_emit.call_count == 2
        types = [c.args[1]["type"] for c in mock_emit.call_args_list]
        assert types == ["content", "error"]

    @pytest.mark.asyncio
    async def test_force_flush_clears_buffer(self):
        """flush() drains the buffer even if delay has not elapsed."""
        opt, mock_emit = _make_optimizer(buffer_ms=10_000)  # very long delay

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": "forced"})
            await opt.flush()

        mock_emit.assert_called_once_with(
            "test-thread", {"type": "content", "chunk": "forced"}
        )

    @pytest.mark.asyncio
    async def test_flush_with_empty_buffer_does_not_emit(self):
        """flush() on an empty buffer should not emit anything."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.flush()

        mock_emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_chunk_is_ignored(self):
        """Empty string chunks must not be buffered or emitted."""
        opt, mock_emit = _make_optimizer()

        with patch("app.orchestrator.sse_optimizer.raw_emit", mock_emit):
            await opt.emit({"type": "content", "chunk": ""})
            await opt.flush()

        mock_emit.assert_not_called()
