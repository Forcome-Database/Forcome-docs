from __future__ import annotations

import json
from typing import Any

from sqlalchemy import Column, Integer, MetaData, String, Table, Text, create_engine, delete, insert, select, update

from app.models.blueprint import BlueprintChangeAuditEntry
from app.models.session import CreationSessionSnapshot


class PostgresSessionStore:
    def __init__(self, *, database_url: str):
        if not database_url:
            raise RuntimeError("database_url is required for the postgres_redis session backend")

        self._engine = create_engine(database_url)
        self._metadata = MetaData()
        self._sessions = Table(
            "ai_creation_sessions",
            self._metadata,
            Column("session_id", String(255), primary_key=True),
            Column("thread_id", String(255), nullable=False),
            Column("snapshot_json", Text, nullable=False),
        )
        self._audits = Table(
            "ai_creation_session_audits",
            self._metadata,
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("session_id", String(255), nullable=False),
            Column("decision", String(64), nullable=False),
            Column("payload_json", Text, nullable=False),
        )
        self._metadata.create_all(self._engine)

    def clear(self) -> None:
        with self._engine.begin() as connection:
            connection.execute(delete(self._audits))
            connection.execute(delete(self._sessions))

    def ensure_session(self, session_id: str, thread_id: str) -> CreationSessionSnapshot:
        existing = self.get_session(session_id)
        if existing is not None:
            return existing

        snapshot = CreationSessionSnapshot(session_id=session_id, thread_id=thread_id)
        self._write_snapshot(snapshot)
        return snapshot

    def upsert_session(self, *, session_id: str, thread_id: str, **updates: Any) -> CreationSessionSnapshot:
        current = self.ensure_session(session_id, thread_id)
        data = current.model_dump()
        data.update(updates)
        snapshot = CreationSessionSnapshot.model_validate(data)
        self._write_snapshot(snapshot)
        return snapshot

    def get_session(self, session_id: str) -> CreationSessionSnapshot | None:
        with self._engine.begin() as connection:
            row = connection.execute(
                select(self._sessions.c.snapshot_json).where(self._sessions.c.session_id == session_id)
            ).first()

        if row is None:
            return None

        payload = json.loads(row[0])
        return CreationSessionSnapshot.model_validate(payload)

    def delete_session(self, session_id: str) -> None:
        with self._engine.begin() as connection:
            connection.execute(delete(self._audits).where(self._audits.c.session_id == session_id))
            connection.execute(delete(self._sessions).where(self._sessions.c.session_id == session_id))

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
        updated_snapshot = snapshot.model_copy(
            update={
                "blueprint_change_audit": [
                    *snapshot.blueprint_change_audit,
                    audit_entry,
                ]
            }
        )
        self._write_snapshot(updated_snapshot)

        with self._engine.begin() as connection:
            connection.execute(
                insert(self._audits).values(
                    session_id=session_id,
                    decision=decision,
                    payload_json=json.dumps(audit_entry.model_dump()),
                )
            )

        return updated_snapshot

    def _write_snapshot(self, snapshot: CreationSessionSnapshot) -> None:
        serialized = json.dumps(snapshot.model_dump(mode="json"))
        with self._engine.begin() as connection:
            existing = connection.execute(
                select(self._sessions.c.session_id).where(self._sessions.c.session_id == snapshot.session_id)
            ).first()
            if existing is None:
                connection.execute(
                    insert(self._sessions).values(
                        session_id=snapshot.session_id,
                        thread_id=snapshot.thread_id,
                        snapshot_json=serialized,
                    )
                )
            else:
                connection.execute(
                    update(self._sessions)
                    .where(self._sessions.c.session_id == snapshot.session_id)
                    .values(
                        thread_id=snapshot.thread_id,
                        snapshot_json=serialized,
                    )
                )
