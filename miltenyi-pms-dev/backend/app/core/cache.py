"""
Tiny TTL cache for tenant-scoped read-heavy endpoints.

Used on Render free-tier where fractional CPU + 8-10 simultaneous
dashboard requests cause queueing. Cutting DB roundtrips for static
reference data (departments, designations) and per-org system settings
frees the event loop to handle the genuinely dynamic endpoints.

Single-process by design. With multiple uvicorn workers each process
has its own cache; an admin write invalidates only the worker that
served it, and other workers serve stale data until their TTL elapses.
That's an acceptable trade for the simplicity of zero external deps —
if you need cross-process consistency, swap this for Redis later.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable


class TTLCache:
    def __init__(self, ttl_seconds: float):
        self._ttl = ttl_seconds
        self._store: dict[Any, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_or_compute(self, key: Any, compute: Callable[[], Any]) -> Any:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is not None and entry[0] > now:
                return entry[1]
        # Compute outside the lock so a slow DB query doesn't block other keys.
        value = compute()
        with self._lock:
            self._store[key] = (now + self._ttl, value)
        return value

    def invalidate(self, key: Any) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Per-org caches. Keys are org_id (int).
# Departments and designations are seeded reference data with no write
# endpoints — a 10-minute TTL is generous and means at most one DB hit
# per org per 10 min per worker.
departments_cache = TTLCache(ttl_seconds=600)
designations_cache = TTLCache(ttl_seconds=600)
# System settings change when an admin saves the cycle config. We invalidate
# on write, but keep a short TTL as a backstop in case a write path is added
# later without remembering to invalidate.
# Two separate caches because /api/v1/settings/ and /api/v1/admin/settings
# return different response shapes from the same underlying row.
system_settings_cache = TTLCache(ttl_seconds=120)
admin_settings_cache = TTLCache(ttl_seconds=120)


def invalidate_settings(org_id: int) -> None:
    """Drop both settings caches for an org. Call from every write path that
    mutates SystemSettings so the next read hits the DB and picks up the
    new state immediately rather than waiting for the TTL to elapse."""
    system_settings_cache.invalidate(org_id)
    admin_settings_cache.invalidate(org_id)
