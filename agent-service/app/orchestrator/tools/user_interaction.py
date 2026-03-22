"""User interaction pause/resume mechanism for orchestrator.

Provides an asyncio.Event-based registry that allows the orchestrator to
pause execution and wait for human input (e.g. Brief confirmation, Blueprint
approval, Review decisions) before continuing.

Usage::

    # In orchestrator node — pause and wait for user response
    await interaction_registry.register(thread_id)
    response = await interaction_registry.wait_for_response(thread_id)

    # In API endpoint — deliver user's response back to waiting coroutine
    interaction_registry.submit_response(thread_id, user_data)
"""
from __future__ import annotations

import asyncio
from enum import StrEnum
from typing import Any

from app.models.review import ReviewIssue, ReviewReport


class InteractionPhase(StrEnum):
    """Phases at which the orchestrator may pause for user input."""

    BRIEF = "brief"
    BLUEPRINT = "blueprint"
    REVIEW = "review"


class InteractionRegistry:
    """Thread-safe registry for pause/resume interactions.

    Each active thread can have at most one pending interaction at a time.
    Attempting to register an already-registered thread replaces the old entry.
    """

    def __init__(self) -> None:
        # Maps thread_id → (asyncio.Event, response_value)
        self._events: dict[str, asyncio.Event] = {}
        self._responses: dict[str, Any] = {}

    def register(self, thread_id: str) -> None:
        """Register a thread as waiting for user input.

        Replaces any existing registration for the same thread_id.

        Args:
            thread_id: Unique thread identifier for the running task.
        """
        event = asyncio.Event()
        self._events[thread_id] = event
        # Clear any stale response
        self._responses.pop(thread_id, None)

    async def wait_for_response(self, thread_id: str, timeout: float = 600) -> Any:
        """Block until a response is submitted for this thread.

        Must be called *after* :meth:`register`.

        Args:
            thread_id: The thread to wait for.
            timeout: Maximum seconds to wait before raising TimeoutError.
                Defaults to 600 (10 minutes).

        Returns:
            The data submitted via :meth:`submit_response`.

        Raises:
            KeyError: If ``thread_id`` is not registered.
            asyncio.TimeoutError: If no response within *timeout* seconds.
        """
        event = self._events.get(thread_id)
        if event is None:
            raise KeyError(f"Thread '{thread_id}' is not registered for interaction")
        await asyncio.wait_for(event.wait(), timeout=timeout)
        return self._responses.get(thread_id)

    def submit_response(self, thread_id: str, data: Any) -> bool:
        """Deliver user data to the waiting coroutine.

        Args:
            thread_id: The thread to wake up.
            data: Arbitrary response data (dict, string, etc.).

        Returns:
            True if the thread was waiting and was woken up.
            False if the thread was not registered.
        """
        event = self._events.get(thread_id)
        if event is None:
            return False
        self._responses[thread_id] = data
        event.set()
        return True

    def cleanup(self, thread_id: str) -> None:
        """Remove all state for a completed or cancelled thread.

        Safe to call multiple times or for unregistered threads.

        Args:
            thread_id: The thread to clean up.
        """
        self._events.pop(thread_id, None)
        self._responses.pop(thread_id, None)

    def is_waiting(self, thread_id: str) -> bool:
        """Check whether a thread is currently waiting for user input.

        Args:
            thread_id: Thread to check.

        Returns:
            True if registered and not yet resolved.
        """
        event = self._events.get(thread_id)
        if event is None:
            return False
        return not event.is_set()


# Module-level singleton
interaction_registry = InteractionRegistry()


def build_synthesis_conflict_review(conflicts: list[dict[str, str]]) -> dict:
    issues = [
        ReviewIssue(
            id=str(conflict.get("conflict_id") or f"conflict-{index + 1}"),
            section_id=None,
            severity="warning",
            category="content",
            description=str(
                conflict.get("details")
                or conflict.get("title")
                or "Sources disagree and need a structured resolution."
            ),
            suggestion="Choose which source to prioritize or describe how to reconcile the disagreement.",
            auto_fixable=False,
            fixed=False,
        )
        for index, conflict in enumerate(conflicts)
    ]
    report = ReviewReport(
        overall_score=0,
        length_compliance=1.0,
        asset_reuse_rate=1.0,
        issues=issues,
        auto_fixed_count=0,
        user_decision_needed=[issue.id for issue in issues],
    )

    return {
        "type": "review",
        "report": report.model_dump(),
    }
