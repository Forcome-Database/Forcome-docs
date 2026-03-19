from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.orchestrator.persistence.postgres_session_store as postgres_session_store_module
from app.orchestrator.persistence.postgres_session_store import PostgresSessionStore
from app.orchestrator.persistence.redis_runtime_store import RedisRuntimeStore
from app.orchestrator.session_store import build_session_store


class _FakeRedisClient:
    def __init__(self):
        self._data: dict[str, str] = {}

    def set(self, key: str, value: str):
        self._data[key] = value

    def get(self, key: str):
        return self._data.get(key)

    def delete(self, *keys: str):
        removed = 0
        for key in keys:
            if key in self._data:
                removed += 1
                del self._data[key]
        return removed

    def keys(self, pattern: str):
        if pattern == "*":
            return list(self._data.keys())
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [key for key in self._data if key.startswith(prefix)]
        return [key for key in self._data if key == pattern]


def test_postgres_session_store_rehydrates_snapshot_across_instances(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'sessions.db'}"

    store = PostgresSessionStore(database_url=database_url)
    store.upsert_session(
        session_id="session-1",
        thread_id="thread-1",
        run_state="awaiting_input",
        phase="blueprint",
        pending_decision={"phase": "blueprint", "data": {"type": "blueprint", "blueprint": {"title": "Doc", "sections": []}}},
        review_report={
            "overall_score": 82,
            "issues": [],
        },
        document_tree={
            "root": {
                "node_id": "document:title",
                "title": "Doc",
                "level": 1,
                "content": "",
            },
            "sections": [
                {
                    "node_id": "section:s1",
                    "section_id": "s1",
                    "title": "Intro",
                    "level": 2,
                    "content": "Persisted section",
                }
            ],
        },
    )
    store.append_blueprint_audit(
        session_id="session-1",
        thread_id="thread-1",
        decision="auto_patch",
        changes=["section s1 must_cover updated"],
    )

    reloaded_store = PostgresSessionStore(database_url=database_url)
    snapshot = reloaded_store.get_session("session-1")

    assert snapshot is not None
    assert snapshot.phase == "blueprint"
    assert snapshot.pending_decision == {
        "phase": "blueprint",
        "data": {"type": "blueprint", "blueprint": {"title": "Doc", "sections": []}},
    }
    assert snapshot.review_report is not None
    assert snapshot.review_report.overall_score == 82
    assert snapshot.document_tree is not None
    assert snapshot.document_tree.sections[0].node_id == "section:s1"
    assert snapshot.blueprint_change_audit[0].changes == ["section s1 must_cover updated"]


def test_postgres_session_store_uses_psycopg_driver_for_default_postgres_urls(monkeypatch):
    captured: dict[str, object] = {}
    fake_engine = object()

    def fake_create_engine(url: str):
        captured["url"] = url
        return fake_engine

    def fake_create_all(self, bind, *args, **kwargs):
        captured["bind"] = bind

    monkeypatch.setattr(postgres_session_store_module, "create_engine", fake_create_engine)
    monkeypatch.setattr(postgres_session_store_module.MetaData, "create_all", fake_create_all)

    PostgresSessionStore(database_url="postgresql://user:pass@localhost:5432/docmost")

    assert captured["url"] == "postgresql+psycopg://user:pass@localhost:5432/docmost"
    assert captured["bind"] is fake_engine


def test_postgres_session_store_strips_schema_query_parameter(monkeypatch):
    captured: dict[str, object] = {}
    fake_engine = object()

    def fake_create_engine(url: str):
        captured["url"] = url
        return fake_engine

    def fake_create_all(self, bind, *args, **kwargs):
        captured["bind"] = bind

    monkeypatch.setattr(postgres_session_store_module, "create_engine", fake_create_engine)
    monkeypatch.setattr(postgres_session_store_module.MetaData, "create_all", fake_create_all)

    PostgresSessionStore(
        database_url="postgresql://user:pass@localhost:5432/docmost?schema=public&sslmode=require"
    )

    assert captured["url"] == "postgresql+psycopg://user:pass@localhost:5432/docmost?sslmode=require"
    assert captured["bind"] is fake_engine


def test_redis_runtime_store_preserves_cancellation_and_resume_metadata():
    runtime_store = RedisRuntimeStore(client=_FakeRedisClient())

    runtime_store.register_run(task_id="task-1", thread_id="thread-1")

    assert runtime_store.get_task_id_for_thread("thread-1") == "task-1"
    assert runtime_store.get_thread_id_for_task("task-1") == "thread-1"
    assert runtime_store.is_task_cancelled("task-1", "thread-1") is False

    assert runtime_store.cancel_task("task-1") is True
    assert runtime_store.is_task_cancelled("task-1", "thread-1") is True

    runtime_store.unregister_run(task_id="task-1", thread_id="thread-1")

    assert runtime_store.get_task_id_for_thread("thread-1") is None
    assert runtime_store.get_thread_id_for_task("task-1") is None
    assert runtime_store.is_task_cancelled("task-1", "thread-1") is False


def test_build_session_store_requires_explicit_memory_backend():
    memory_store = build_session_store(
        SimpleNamespace(
            session_backend="memory",
            database_url="",
            redis_url="",
        )
    )
    memory_store.upsert_session(session_id="session-1", thread_id="thread-1", phase="brief")

    assert memory_store.get_session("session-1") is not None

    with pytest.raises(RuntimeError):
        build_session_store(
            SimpleNamespace(
                session_backend="postgres_redis",
                database_url="",
                redis_url="",
            )
        )
