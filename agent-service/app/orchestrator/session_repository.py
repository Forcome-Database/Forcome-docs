from __future__ import annotations

from typing import Any, Protocol

from app.models.session import CreationSessionSnapshot


class SessionSnapshotRepository(Protocol):
    def clear(self) -> None: ...

    def ensure_session(
        self,
        session_id: str,
        thread_id: str,
    ) -> CreationSessionSnapshot: ...

    def upsert_session(
        self,
        *,
        session_id: str,
        thread_id: str,
        **updates: Any,
    ) -> CreationSessionSnapshot: ...

    def get_session(self, session_id: str) -> CreationSessionSnapshot | None: ...

    def delete_session(self, session_id: str) -> None: ...

    def append_blueprint_audit(
        self,
        *,
        session_id: str,
        thread_id: str,
        decision: str,
        changes: list[str],
    ) -> CreationSessionSnapshot: ...


class RuntimeStateStore(Protocol):
    def clear(self) -> None: ...

    def register_run(self, *, task_id: str, thread_id: str) -> None: ...

    def unregister_run(self, *, task_id: str, thread_id: str) -> None: ...

    def cancel_task(self, task_id: str) -> bool: ...

    def is_task_cancelled(
        self,
        task_id: str | None,
        thread_id: str | None,
    ) -> bool: ...

    def get_task_id_for_thread(self, thread_id: str) -> str | None: ...

    def get_thread_id_for_task(self, task_id: str) -> str | None: ...
