"""Redis-backed conversation store for Agent v2 multi-turn sessions.

Key design decisions:
- Key format: ``agent:conv:{thread_id}`` (CONV_KEY_PREFIX + thread_id)
- Envelope: JSON ``{"schema_version": int, "user_id": str, "messages_json": str}``
- TTL: 86400 s (24 h)
- Security: user_id is stored; load() rejects mismatches silently.
- Pruning: strip BinaryContent → keep last MAX_FULL_TURNS turns → hard-cap 100 KB.
- Serialisation: ``TypeAdapter(list[ModelMessage])`` for PydanticAI round-tripping.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import TypeAdapter
from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    UserPromptPart,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------------

CONV_KEY_PREFIX: str = "agent:conv:"
CONV_TTL: int = 86400          # 24 hours in seconds
SCHEMA_VERSION: int = 1
MAX_FULL_TURNS: int = 6        # keep last 6 turns = 12 messages
_HARD_CAP_BYTES: int = 100 * 1024  # 100 KB

_TA: TypeAdapter[list[ModelMessage]] = TypeAdapter(list[ModelMessage])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_binary(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Return a new list with BinaryContent removed from UserPromptParts.

    Images are large and useless in subsequent turns.  All other message
    types / part types are kept unchanged.
    """
    cleaned: list[ModelMessage] = []
    for msg in messages:
        if not isinstance(msg, ModelRequest):
            cleaned.append(msg)
            continue

        new_parts: list[Any] = []
        for part in msg.parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, list):
                filtered = [
                    item for item in part.content
                    if not isinstance(item, BinaryContent)
                ]
                # Re-create the part with cleaned content
                new_parts.append(UserPromptPart(content=filtered))
            else:
                new_parts.append(part)

        # Re-create the request with new parts
        cleaned.append(ModelRequest(parts=new_parts))

    return cleaned


def _prune(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Apply turn-count cap and 100 KB hard cap.

    A "turn" is one (ModelRequest, ModelResponse) pair = 2 messages.
    Pairs are dropped from the *oldest* end.
    """
    # Step 1: keep last MAX_FULL_TURNS turns
    max_msgs = MAX_FULL_TURNS * 2
    if len(messages) > max_msgs:
        messages = messages[-max_msgs:]

    # Step 2: hard cap — drop oldest pair until under limit
    while messages:
        serialised = _TA.dump_json(messages)
        if len(serialised) <= _HARD_CAP_BYTES:
            break
        if len(messages) < 2:
            # Cannot drop further — store nothing rather than corrupt data
            messages = []
            break
        # Drop the oldest pair
        messages = messages[2:]

    return messages


# ---------------------------------------------------------------------------
# ConversationStore
# ---------------------------------------------------------------------------

class ConversationStore:
    """Async Redis-backed store for PydanticAI conversation history.

    Args:
        redis_client: An async Redis client (``redis.asyncio.Redis``).
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    # ------------------------------------------------------------------
    # load
    # ------------------------------------------------------------------

    async def load(self, thread_id: str, user_id: str) -> list[ModelMessage] | None:
        """Load conversation history for *thread_id*.

        Returns:
            The stored message list, or ``None`` if nothing is stored,
            the user_id doesn't match, or the schema version is stale.
        """
        key = f"{CONV_KEY_PREFIX}{thread_id}"
        raw = await self._redis.get(key)
        if raw is None:
            return None

        try:
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode()
            envelope: dict[str, Any] = json.loads(raw)
        except Exception as exc:
            logger.warning("Failed to parse conversation envelope for %s: %s", thread_id, exc)
            return None

        # Schema version check
        stored_version = envelope.get("schema_version")
        if stored_version != SCHEMA_VERSION:
            logger.warning(
                "Discarding conversation for %s: schema version mismatch (%s != %s)",
                thread_id, stored_version, SCHEMA_VERSION,
            )
            return None

        # Security: user_id must match
        if envelope.get("user_id") != user_id:
            logger.warning(
                "Rejected conversation load for %s: user_id mismatch", thread_id
            )
            return None

        try:
            messages = _TA.validate_json(envelope["messages_json"])
        except Exception as exc:
            logger.warning("Failed to deserialise messages for %s: %s", thread_id, exc)
            return None

        return messages

    # ------------------------------------------------------------------
    # save
    # ------------------------------------------------------------------

    async def save(
        self,
        thread_id: str,
        user_id: str,
        messages: list[ModelMessage],
    ) -> None:
        """Persist *messages* for *thread_id* with a 24 h TTL.

        Applies BinaryContent stripping and turn/size pruning before storage.
        """
        key = f"{CONV_KEY_PREFIX}{thread_id}"

        # 1. Strip binary content (images are useless in future turns)
        cleaned = _strip_binary(messages)

        # 2. Prune: turn count + hard size cap
        pruned = _prune(cleaned)

        if not pruned:
            logger.debug("Nothing to save for thread %s after pruning", thread_id)
            return

        try:
            messages_json = _TA.dump_json(pruned).decode()
        except Exception as exc:
            logger.warning("Failed to serialise messages for %s: %s", thread_id, exc)
            return

        envelope = json.dumps({
            "schema_version": SCHEMA_VERSION,
            "user_id": user_id,
            "messages_json": messages_json,
        })

        await self._redis.set(key, envelope, ex=CONV_TTL)

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    async def delete(self, thread_id: str) -> None:
        """Remove all stored history for *thread_id*."""
        key = f"{CONV_KEY_PREFIX}{thread_id}"
        await self._redis.delete(key)
