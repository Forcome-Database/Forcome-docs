from __future__ import annotations

from redis import Redis


class RedisRuntimeStore:
    def __init__(
        self,
        *,
        redis_url: str = "",
        client: Redis | object | None = None,
    ):
        if client is None and not redis_url:
            raise RuntimeError("redis_url is required for the postgres_redis session backend")

        self._client = client or Redis.from_url(redis_url, decode_responses=True)

    def clear(self) -> None:
        keys = []
        keys.extend(self._keys("ai-creator:task:*"))
        keys.extend(self._keys("ai-creator:thread:*"))
        keys.extend(self._keys("ai-creator:cancel:*"))
        if keys:
            self._client.delete(*keys)

    def register_run(self, *, task_id: str, thread_id: str) -> None:
        self._client.set(self._task_key(task_id), thread_id)
        self._client.set(self._thread_key(thread_id), task_id)
        self._client.delete(self._cancel_key(task_id))

    def unregister_run(self, *, task_id: str, thread_id: str) -> None:
        self._client.delete(
            self._task_key(task_id),
            self._thread_key(thread_id),
            self._cancel_key(task_id),
        )

    def cancel_task(self, task_id: str) -> bool:
        thread_id = self.get_thread_id_for_task(task_id)
        if thread_id is None:
            return False

        self._client.set(self._cancel_key(task_id), "1")
        return True

    def is_task_cancelled(
        self,
        task_id: str | None,
        thread_id: str | None,
    ) -> bool:
        resolved_task_id = task_id
        if resolved_task_id is None and thread_id:
            resolved_task_id = self.get_task_id_for_thread(thread_id)
        if resolved_task_id is None:
            return False

        return self._client.get(self._cancel_key(resolved_task_id)) == "1"

    def get_task_id_for_thread(self, thread_id: str) -> str | None:
        value = self._client.get(self._thread_key(thread_id))
        return str(value) if value is not None else None

    def get_thread_id_for_task(self, task_id: str) -> str | None:
        value = self._client.get(self._task_key(task_id))
        return str(value) if value is not None else None

    def _keys(self, pattern: str) -> list[str]:
        values = self._client.keys(pattern)
        return [value.decode() if isinstance(value, bytes) else str(value) for value in values]

    @staticmethod
    def _task_key(task_id: str) -> str:
        return f"ai-creator:task:{task_id}"

    @staticmethod
    def _thread_key(thread_id: str) -> str:
        return f"ai-creator:thread:{thread_id}"

    @staticmethod
    def _cancel_key(task_id: str) -> str:
        return f"ai-creator:cancel:{task_id}"
