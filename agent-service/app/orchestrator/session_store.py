from __future__ import annotations

from typing import Any

from app.config import settings
from app.models.blueprint import BlueprintChangeAuditEntry
from app.models.session import CreationSessionSnapshot
from app.orchestrator.persistence.postgres_session_store import PostgresSessionStore
from app.orchestrator.persistence.redis_runtime_store import RedisRuntimeStore
from app.orchestrator.session_repository import RuntimeStateStore, SessionSnapshotRepository


class InMemorySessionRepository:
    def __init__(self):
        self._sessions: dict[str, CreationSessionSnapshot] = {}

    def clear(self) -> None:
        self._sessions.clear()

    def ensure_session(self, session_id: str, thread_id: str) -> CreationSessionSnapshot:
        existing = self._sessions.get(session_id)
        if existing:
            return existing

        session = CreationSessionSnapshot(session_id=session_id, thread_id=thread_id)
        self._sessions[session_id] = session
        return session

    def upsert_session(self, *, session_id: str, thread_id: str, **updates: Any) -> CreationSessionSnapshot:
        current = self.ensure_session(session_id, thread_id)
        data = current.model_dump()
        data.update(updates)
        session = CreationSessionSnapshot.model_validate(data)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> CreationSessionSnapshot | None:
        return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def append_blueprint_audit(
        self,
        *,
        session_id: str,
        thread_id: str,
        decision: str,
        changes: list[str],
    ) -> CreationSessionSnapshot:
        snapshot = self.ensure_session(session_id, thread_id)
        audit_entry = BlueprintChangeAuditEntry(
            decision=decision,
            changes=changes,
        )
        updated = snapshot.model_copy(
            update={
                "blueprint_change_audit": [
                    *snapshot.blueprint_change_audit,
                    audit_entry,
                ]
            }
        )
        self._sessions[session_id] = updated
        return updated


class InMemoryRuntimeStore:
    def __init__(self):
        self._task_to_thread: dict[str, str] = {}
        self._thread_to_task: dict[str, str] = {}
        self._cancelled_tasks: set[str] = set()

    def clear(self) -> None:
        self._task_to_thread.clear()
        self._thread_to_task.clear()
        self._cancelled_tasks.clear()

    def register_run(self, *, task_id: str, thread_id: str) -> None:
        self._task_to_thread[task_id] = thread_id
        self._thread_to_task[thread_id] = task_id
        self._cancelled_tasks.discard(task_id)

    def unregister_run(self, *, task_id: str, thread_id: str) -> None:
        self._task_to_thread.pop(task_id, None)
        self._thread_to_task.pop(thread_id, None)
        self._cancelled_tasks.discard(task_id)

    def cancel_task(self, task_id: str) -> bool:
        if task_id not in self._task_to_thread:
            return False
        self._cancelled_tasks.add(task_id)
        return True

    def is_task_cancelled(self, task_id: str | None, thread_id: str | None) -> bool:
        resolved_task_id = task_id
        if resolved_task_id is None and thread_id:
            resolved_task_id = self._thread_to_task.get(thread_id)
        if resolved_task_id is None:
            return False
        return resolved_task_id in self._cancelled_tasks

    def get_task_id_for_thread(self, thread_id: str) -> str | None:
        return self._thread_to_task.get(thread_id)

    def get_thread_id_for_task(self, task_id: str) -> str | None:
        return self._task_to_thread.get(task_id)


class SessionStore:
    def __init__(
        self,
        *,
        snapshot_repository: SessionSnapshotRepository | None = None,
        runtime_store: RuntimeStateStore | None = None,
        backend: str | None = None,
        settings_obj: object | None = None,
    ):
        self._snapshot_repository = snapshot_repository
        self._runtime_store = runtime_store
        self._backend = backend
        self._settings = settings_obj or settings

    @property
    def backend(self) -> str:
        self._ensure_configured()
        return self._backend or "memory"

    def configure(
        self,
        *,
        snapshot_repository: SessionSnapshotRepository,
        runtime_store: RuntimeStateStore,
        backend: str,
    ) -> None:
        self._snapshot_repository = snapshot_repository
        self._runtime_store = runtime_store
        self._backend = backend

    def use_memory_backend(self) -> None:
        self.configure(
            snapshot_repository=InMemorySessionRepository(),
            runtime_store=InMemoryRuntimeStore(),
            backend="memory",
        )

    def clear(self) -> None:
        self._ensure_configured()
        self._snapshot_repository.clear()
        self._runtime_store.clear()

    def ensure_session(self, session_id: str, thread_id: str) -> CreationSessionSnapshot:
        self._ensure_configured()
        return self._snapshot_repository.ensure_session(session_id, thread_id)

    def upsert_session(self, *, session_id: str, thread_id: str, **updates: Any) -> CreationSessionSnapshot:
        self._ensure_configured()
        return self._snapshot_repository.upsert_session(
            session_id=session_id,
            thread_id=thread_id,
            **updates,
        )

    def get_session(self, session_id: str) -> CreationSessionSnapshot | None:
        self._ensure_configured()
        return self._snapshot_repository.get_session(session_id)

    def delete_session(self, session_id: str) -> None:
        self._ensure_configured()
        self._snapshot_repository.delete_session(session_id)

    def append_blueprint_audit(
        self,
        *,
        session_id: str,
        thread_id: str,
        decision: str,
        changes: list[str],
    ) -> CreationSessionSnapshot:
        self._ensure_configured()
        return self._snapshot_repository.append_blueprint_audit(
            session_id=session_id,
            thread_id=thread_id,
            decision=decision,
            changes=changes,
        )

    def register_run(self, *, task_id: str, thread_id: str) -> None:
        self._ensure_configured()
        self._runtime_store.register_run(task_id=task_id, thread_id=thread_id)

    def unregister_run(self, *, task_id: str, thread_id: str) -> None:
        self._ensure_configured()
        self._runtime_store.unregister_run(task_id=task_id, thread_id=thread_id)

    def cancel_task(self, task_id: str) -> bool:
        self._ensure_configured()
        return self._runtime_store.cancel_task(task_id)

    def is_task_cancelled(self, task_id: str | None, thread_id: str | None) -> bool:
        self._ensure_configured()
        return self._runtime_store.is_task_cancelled(task_id, thread_id)

    def get_task_id_for_thread(self, thread_id: str) -> str | None:
        self._ensure_configured()
        return self._runtime_store.get_task_id_for_thread(thread_id)

    def get_thread_id_for_task(self, task_id: str) -> str | None:
        self._ensure_configured()
        return self._runtime_store.get_thread_id_for_task(task_id)

    def _ensure_configured(self) -> None:
        if self._snapshot_repository is not None and self._runtime_store is not None:
            return

        configured_store = build_session_store(self._settings)
        self.configure(
            snapshot_repository=configured_store._snapshot_repository,
            runtime_store=configured_store._runtime_store,
            backend=configured_store._backend or "memory",
        )


def build_session_store(settings_obj: object) -> SessionStore:
    backend = getattr(settings_obj, "session_backend", "postgres_redis")
    if backend == "memory":
        return SessionStore(
            snapshot_repository=InMemorySessionRepository(),
            runtime_store=InMemoryRuntimeStore(),
            backend="memory",
            settings_obj=settings_obj,
        )

    if backend == "postgres_redis":
        database_url = getattr(settings_obj, "database_url", "")
        redis_url = getattr(settings_obj, "redis_url", "")
        if not database_url or not redis_url:
            raise RuntimeError(
                "postgres_redis session backend requires both database_url and redis_url; "
                "use session_backend=memory explicitly for development or tests"
            )

        return SessionStore(
            snapshot_repository=PostgresSessionStore(database_url=database_url),
            runtime_store=RedisRuntimeStore(redis_url=redis_url),
            backend="postgres_redis",
            settings_obj=settings_obj,
        )

    raise RuntimeError(f"Unsupported session backend: {backend}")


session_store = SessionStore(settings_obj=settings)
