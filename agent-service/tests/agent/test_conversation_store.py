"""Unit tests for ConversationStore — Redis-backed multi-turn conversation history.

Uses unittest.mock.AsyncMock to stub Redis, so no real Redis is needed.
"""
from __future__ import annotations

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
    TextPart,
    BinaryContent,
)
from pydantic import TypeAdapter

from app.agent.conversation_store import (
    ConversationStore,
    CONV_KEY_PREFIX,
    CONV_TTL,
    SCHEMA_VERSION,
    MAX_FULL_TURNS,
)

_TA = TypeAdapter(list[ModelMessage])


def _make_request(text: str = "hello") -> ModelRequest:
    return ModelRequest(parts=[UserPromptPart(content=text)])


def _make_response(text: str = "world") -> ModelResponse:
    return ModelResponse(
        parts=[TextPart(content=text)],
        model_name="test-model",
        timestamp=datetime.now(timezone.utc),
    )


def _make_turn(user: str = "hello", assistant: str = "world") -> list[ModelMessage]:
    return [_make_request(user), _make_response(assistant)]


def _make_redis_mock() -> AsyncMock:
    """Return an async Redis mock with get/set/delete stubbed."""
    mock = AsyncMock()
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock(return_value=True)
    mock.delete = AsyncMock(return_value=1)
    return mock


# ---------------------------------------------------------------------------
# test_key_format
# ---------------------------------------------------------------------------

def test_key_format():
    """CONV_KEY_PREFIX constant must match the spec."""
    assert CONV_KEY_PREFIX == "agent:conv:"
    assert CONV_TTL == 86400
    assert isinstance(SCHEMA_VERSION, int)
    assert SCHEMA_VERSION >= 1


# ---------------------------------------------------------------------------
# test_load_returns_none_when_no_history
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_load_returns_none_when_no_history():
    """load() returns None when Redis has no entry for the thread."""
    redis = _make_redis_mock()
    redis.get = AsyncMock(return_value=None)

    store = ConversationStore(redis)
    result = await store.load("thread-123", "user-abc")

    assert result is None
    redis.get.assert_called_once_with(f"{CONV_KEY_PREFIX}thread-123")


# ---------------------------------------------------------------------------
# test_load_returns_messages_when_valid
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_load_returns_messages_when_valid():
    """load() deserialises and returns messages when the key exists and user matches."""
    messages = _make_turn("hi", "hello back")
    messages_json = _TA.dump_json(messages).decode()

    envelope = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "user_id": "user-abc",
        "messages_json": messages_json,
    })

    redis = _make_redis_mock()
    redis.get = AsyncMock(return_value=envelope.encode())

    store = ConversationStore(redis)
    result = await store.load("thread-123", "user-abc")

    assert result is not None
    assert len(result) == 2
    assert isinstance(result[0], ModelRequest)
    assert isinstance(result[1], ModelResponse)


# ---------------------------------------------------------------------------
# test_load_rejects_wrong_user
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_load_rejects_wrong_user():
    """load() returns None (silently) when the stored user_id doesn't match."""
    messages = _make_turn()
    messages_json = _TA.dump_json(messages).decode()

    envelope = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "user_id": "legit-user",
        "messages_json": messages_json,
    })

    redis = _make_redis_mock()
    redis.get = AsyncMock(return_value=envelope.encode())

    store = ConversationStore(redis)
    result = await store.load("thread-123", "attacker-user")

    assert result is None


# ---------------------------------------------------------------------------
# test_load_rejects_wrong_schema_version
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_load_rejects_wrong_schema_version():
    """load() discards data whose schema_version != SCHEMA_VERSION."""
    messages = _make_turn()
    messages_json = _TA.dump_json(messages).decode()

    envelope = json.dumps({
        "schema_version": SCHEMA_VERSION + 99,
        "user_id": "user-abc",
        "messages_json": messages_json,
    })

    redis = _make_redis_mock()
    redis.get = AsyncMock(return_value=envelope.encode())

    store = ConversationStore(redis)
    result = await store.load("thread-123", "user-abc")

    assert result is None


# ---------------------------------------------------------------------------
# test_save_stores_with_ttl
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_stores_with_ttl():
    """save() calls redis.set with ex=CONV_TTL and serialises the envelope."""
    messages = _make_turn()

    redis = _make_redis_mock()
    store = ConversationStore(redis)

    await store.save("thread-123", "user-abc", messages)

    redis.set.assert_called_once()
    call_args = redis.set.call_args

    key = call_args[0][0]
    value = call_args[0][1]
    ttl = call_args[1].get("ex") or call_args[0][2]  # positional or kwarg

    assert key == f"{CONV_KEY_PREFIX}thread-123"
    assert ttl == CONV_TTL

    # value must be a valid JSON envelope
    parsed = json.loads(value)
    assert parsed["schema_version"] == SCHEMA_VERSION
    assert parsed["user_id"] == "user-abc"
    assert "messages_json" in parsed


# ---------------------------------------------------------------------------
# test_save_prunes_old_turns
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_prunes_old_turns():
    """save() keeps at most MAX_FULL_TURNS turns (2 messages each)."""
    # Build MAX_FULL_TURNS + 2 turns (excess should be dropped)
    excess = 2
    total_turns = MAX_FULL_TURNS + excess
    messages: list[ModelMessage] = []
    for i in range(total_turns):
        messages.extend(_make_turn(f"user {i}", f"assistant {i}"))

    redis = _make_redis_mock()
    store = ConversationStore(redis)

    await store.save("thread-prune", "user-abc", messages)

    # Recover what was stored
    call_args = redis.set.call_args
    stored_value = call_args[0][1]
    parsed = json.loads(stored_value)
    restored = _TA.validate_json(parsed["messages_json"])

    # Should have exactly MAX_FULL_TURNS * 2 messages (pairs)
    assert len(restored) == MAX_FULL_TURNS * 2


# ---------------------------------------------------------------------------
# test_save_strips_binary_content
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_strips_binary_content():
    """save() removes BinaryContent from UserPromptParts before storage."""
    request_with_image = ModelRequest(
        parts=[
            UserPromptPart(
                content=[
                    "Describe this",
                    BinaryContent(data=b"\x89PNG\r\n", media_type="image/png"),
                ]
            )
        ]
    )
    response = _make_response("It is a chart")
    messages: list[ModelMessage] = [request_with_image, response]

    redis = _make_redis_mock()
    store = ConversationStore(redis)

    await store.save("thread-img", "user-abc", messages)

    call_args = redis.set.call_args
    stored_value = call_args[0][1]
    parsed = json.loads(stored_value)
    restored = _TA.validate_json(parsed["messages_json"])

    # The request should still be there but BinaryContent should be gone
    req = restored[0]
    assert isinstance(req, ModelRequest)
    for part in req.parts:
        if hasattr(part, "content") and isinstance(part.content, list):
            for item in part.content:
                assert not isinstance(item, BinaryContent), "BinaryContent survived strip"


# ---------------------------------------------------------------------------
# test_delete
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete():
    """delete() calls redis.delete with the correct key."""
    redis = _make_redis_mock()
    store = ConversationStore(redis)

    await store.delete("thread-123")

    redis.delete.assert_called_once_with(f"{CONV_KEY_PREFIX}thread-123")


# ---------------------------------------------------------------------------
# test_save_hard_cap_100kb
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_hard_cap_100kb():
    """save() drops oldest pairs until the serialized payload is under 100 KB."""
    # Build large messages that together exceed 100 KB
    big_text = "x" * 5_000  # 5 KB per message text
    messages: list[ModelMessage] = []
    for i in range(30):
        messages.extend(_make_turn(big_text, big_text))

    redis = _make_redis_mock()
    store = ConversationStore(redis)

    await store.save("thread-big", "user-abc", messages)

    call_args = redis.set.call_args
    stored_value = call_args[0][1]

    # The stored value (as bytes) must be under 100 KB
    assert len(stored_value.encode() if isinstance(stored_value, str) else stored_value) < 100 * 1024
