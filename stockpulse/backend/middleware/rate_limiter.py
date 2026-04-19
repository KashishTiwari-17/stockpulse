"""
Rate limiter middleware — sliding window per IP.
Limits REST endpoints; WebSocket paths are excluded.
"""

import time
import logging
from collections import defaultdict, deque
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.rpm = requests_per_minute
        self._windows: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip WebSocket upgrade and health check
        if request.url.path.startswith("/ws") or request.url.path == "/health":
            return await call_next(request)

        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = self._windows[ip]

        # Remove timestamps older than 60s
        while window and now - window[0] > 60:
            window.popleft()

        if len(window) >= self.rpm:
            logger.warning("Rate limit exceeded for %s", ip)
            return Response(
                content='{"detail":"Too many requests — slow down"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": "60"},
            )

        window.append(now)
        return await call_next(request)
