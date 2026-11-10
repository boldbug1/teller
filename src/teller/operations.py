from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import WebSocket

from teller.api_models import OperationEnvelope


class OperationRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._operations: dict[str, OperationEnvelope] = {}
        self._cancel_flags: dict[str, asyncio.Event] = {}
        self._active_keys: dict[str, str] = {}  # key -> operation_id
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._subscribers: set[WebSocket] = set()

    async def register_subscriber(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subscribers.add(ws)

    async def unregister_subscriber(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subscribers.discard(ws)

    async def broadcast(self, envelope: OperationEnvelope) -> None:
        async with self._lock:
            subscribers = list(self._subscribers)
        message = envelope.model_dump_json()
        disconnected: list[WebSocket] = []
        for ws in subscribers:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(ws)
        if disconnected:
            async with self._lock:
                for ws in disconnected:
                    self._subscribers.discard(ws)

    async def get_or_create(
        self,
        kind: str,
        dedup_key: str | None = None,
    ) -> tuple[str, bool]:
        """
        Returns (operation_id, is_new).
        If dedup_key is active, returns the existing id with is_new=False.
        """
        async with self._lock:
            if dedup_key and dedup_key in self._active_keys:
                existing_id = self._active_keys[dedup_key]
                existing_op = self._operations.get(existing_id)
                if existing_op and existing_op.state in ("pending", "running"):
                    return existing_id, False

            op_id = f"op-{uuid.uuid4().hex[:12]}"
            envelope = OperationEnvelope(
                operation_id=op_id,
                kind=kind,
                state="pending",
                completed=0,
                total=0,
                message_code="operation_created",
            )
            self._operations[op_id] = envelope
            self._cancel_flags[op_id] = asyncio.Event()
            if dedup_key:
                self._active_keys[dedup_key] = op_id
            return op_id, True

    async def update(
        self,
        operation_id: str,
        *,
        state: str | None = None,
        completed: int | None = None,
        total: int | None = None,
        message_code: str | None = None,
        error: str | None = None,
    ) -> OperationEnvelope | None:
        async with self._lock:
            op = self._operations.get(operation_id)
            if not op:
                return None
            if state is not None:
                op.state = state
            if completed is not None:
                op.completed = completed
            if total is not None:
                op.total = total
            if message_code is not None:
                op.message_code = message_code
            if error is not None:
                op.error = error

            # If finished, clear from active_keys
            if op.state in ("completed", "failed", "cancelled"):
                for k, v in list(self._active_keys.items()):
                    if v == operation_id:
                        del self._active_keys[k]

            copy = op.model_copy()

        await self.broadcast(copy)
        return copy

    def is_cancelled(self, operation_id: str) -> bool:
        flag = self._cancel_flags.get(operation_id)
        return flag.is_set() if flag else False

    async def cancel(self, operation_id: str) -> bool:
        async with self._lock:
            op = self._operations.get(operation_id)
            if not op or op.state not in ("pending", "running"):
                return False
            flag = self._cancel_flags.get(operation_id)
            if flag:
                flag.set()
            task = self._tasks.get(operation_id)
            if task and not task.done():
                task.cancel()

        await self.update(
            operation_id,
            state="cancelled",
            message_code="operation_cancelled",
        )
        return True

    def get(self, operation_id: str) -> OperationEnvelope | None:
        op = self._operations.get(operation_id)
        return op.model_copy() if op else None

    def set_task(self, operation_id: str, task: asyncio.Task[Any]) -> None:
        self._tasks[operation_id] = task


# Global singleton registry for the API process
operations = OperationRegistry()
