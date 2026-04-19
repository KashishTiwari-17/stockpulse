"""
Cache service — in-memory TTL cache (drop-in Redis replacement).
For production: swap _store with aioredis.
"""

import asyncio
import time
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TTLCache:
    """Thread-safe async in-memory cache with per-key TTL."""

    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}   # key → (value, expires_at)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl: int = 60):
        async with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    async def delete(self, key: str):
        async with self._lock:
            self._store.pop(key, None)

    async def clear_expired(self):
        """Purge expired entries — call periodically."""
        now = time.monotonic()
        async with self._lock:
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
        if expired:
            logger.debug("Purged %d expired cache entries", len(expired))


# Singleton
cache = TTLCache()
