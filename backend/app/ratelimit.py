"""Rate limiting and a concurrency cap for the one expensive endpoint.

The dashboard serves public, read-only NASA data — there is nothing to log in
to, so it does not have user accounts and should not grow them. The single
resource worth protecting is ``POST /api/prometheus/ask``, which spends a real
LLM call per request. That is a throughput problem, not an identity problem, so
this is a per-client sliding window plus a global concurrency cap: no database,
no sessions, no passwords.

Both are configurable and off when set to 0, and an API key gate exists for
operators who deploy publicly (unset by default, so a local demo needs no key).
"""
from __future__ import annotations

import threading
import time
from collections import deque

MAX_TRACKED_CLIENTS = 4096


class SlidingWindowLimiter:
    """Allow at most ``max_events`` attempts per ``window_s`` for each key.

    The number of tracked clients is bounded. An earlier version evicted only
    keys whose deque was empty, which never happened — every key was created by
    ``setdefault`` and immediately appended to — so the cap was dead code and a
    client that rotated its address could grow the dict without bound. The
    limiter now keeps a last-seen stamp per key and drops the least recently
    used one once the cap is exceeded.
    """

    def __init__(self, max_events: int, window_s: float,
                 max_clients: int = MAX_TRACKED_CLIENTS) -> None:
        self.max_events = max_events
        self.window_s = window_s
        self.max_clients = max_clients
        self._hits: dict[str, deque[float]] = {}
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def _evict_if_needed(self, now: float) -> None:
        """Drop keys until the dict is back under the cap.

        Clients that have not been seen for a whole window are evicted first:
        their allowance has expired anyway, so dropping them costs nobody a
        slot. Only when that is not enough — more clients are active within one
        window than the cap allows — does the least recently seen one go. That
        is the price of a hard memory bound, and it is why the default cap is
        far above the number of clients one deployment will ever see.
        """
        overflow = len(self._hits) - self.max_clients
        if overflow <= 0:
            return
        idle = [k for k, seen in self._seen.items()
                if now - seen > self.window_s]
        for key in sorted(idle, key=self._seen.get)[:overflow]:
            self._hits.pop(key, None)
            self._seen.pop(key, None)
        overflow = len(self._hits) - self.max_clients
        if overflow > 0:
            for key in sorted(self._seen, key=self._seen.get)[:overflow]:
                self._hits.pop(key, None)
                self._seen.pop(key, None)

    def check(self, key: str) -> tuple[bool, int]:
        """Record one attempt.

        Returns ``(allowed, retry_after_seconds)``. A non-positive ``max_events``
        disables the limiter, which keeps the default local run frictionless.
        """
        if self.max_events <= 0:
            return True, 0
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            self._seen[key] = now
            cutoff = now - self.window_s
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= self.max_events:
                retry = int(self.window_s - (now - q[0])) + 1
                self._evict_if_needed(now)
                return False, max(retry, 1)
            q.append(now)
            self._evict_if_needed(now)
            return True, 0


class ConcurrencyGuard:
    """Bound how many expensive calls may run at the same time."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._sem = threading.BoundedSemaphore(limit) if limit > 0 else None

    def acquire(self) -> bool:
        """Try to take a slot without blocking."""
        return True if self._sem is None else self._sem.acquire(blocking=False)

    def release(self) -> None:
        if self._sem is not None:
            try:
                self._sem.release()
            except ValueError:  # released more than acquired; never corrupt state
                pass
