from __future__ import annotations

from typing import Any

from app.models.session import CreationSessionSnapshot


class SessionStore:
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


session_store = SessionStore()
