"""Live updates: tell open screens that something changed, so they refresh.

Every change (a bill paid, a booking, an expense...) publishes a short topic
like "orders" through PostgreSQL NOTIFY. Each server process LISTENs on one
connection and passes it to the browsers connected to it by WebSocket. Using
the database means it still works when the server runs several processes.
If the database link drops, changes are still sent to this process's
screens, and the screens also refresh on their own timers.
"""

import asyncio
import json
import logging

import asyncpg

from app.core.config import get_settings

log = logging.getLogger("app.live")
CHANNEL = "barpos_live"


class Hub:
    def __init__(self) -> None:
        self.queues: set[asyncio.Queue[str]] = set()
        self._conn: asyncpg.Connection | None = None
        self._lock = asyncio.Lock()
        self._send = asyncio.Lock()  # one query at a time on the shared connection

    # ---- browsers ------------------------------------------------------------
    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        self.queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self.queues.discard(q)

    def deliver(self, message: str) -> None:
        for q in list(self.queues):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:  # a stuck browser; it refreshes on its timer anyway
                pass

    # ---- database link ---------------------------------------------------------
    async def _connection(self) -> asyncpg.Connection | None:
        async with self._lock:
            if self._conn is not None and not self._conn.is_closed():
                return self._conn
            dsn = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
            try:
                conn = await asyncpg.connect(dsn, timeout=5)
                await conn.add_listener(CHANNEL, lambda *args: self.deliver(args[3]))
                self._conn = conn
            except (OSError, asyncpg.PostgresError, asyncio.TimeoutError) as e:
                log.warning("Live updates: database link failed (%s); local only", e)
                self._conn = None
            return self._conn

    async def start(self) -> None:
        await self._connection()

    async def stop(self) -> None:
        if self._conn is not None and not self._conn.is_closed():
            await self._conn.close()
        self._conn = None

    async def publish(self, topic: str, user_id: int | None = None) -> None:
        message = json.dumps({"topic": topic, "by": user_id})
        conn = await self._connection()
        if conn is None:
            self.deliver(message)
            return
        try:
            async with self._send:
                await conn.execute("SELECT pg_notify($1, $2)", CHANNEL, message)
        except (OSError, asyncpg.PostgresError) as e:
            log.warning("Live updates: notify failed (%s)", e)
            self.deliver(message)


hub = Hub()

# Which part of the app a change belongs to, from the first part of its URL.
TOPICS = {
    "orders": "orders",
    "kitchen": "kitchen",
    "tables": "orders",
    "bookings": "rooms",
    "rooms": "rooms",
    "room-types": "rooms",
    "items": "stock",
    "categories": "stock",
    "open-bottles": "stock",
    "purchases": "stock",
    "expenses": "money",
    "expense-categories": "money",
    "shifts": "money",
    "settings": "settings",
}


def topic_for(path: str) -> str | None:
    """'/api/orders/12/payments' -> 'orders'. None for things screens don't show live."""
    parts = path.removeprefix("/api/").split("/")
    return TOPICS.get(parts[0]) if parts and parts[0] else None
