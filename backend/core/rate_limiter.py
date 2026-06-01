"""
Redis-based sliding window rate limiter for FastAPI.

Implements per-user and global rate limiting using Redis sorted sets
(sliding window log algorithm). This provides accurate rate limiting
that doesn't suffer from the boundary issues of fixed-window counters.

Algorithm:
    - Each request is logged as a member in a Redis sorted set with
      the current timestamp as the score.
    - On each request, expired entries (outside the window) are pruned.
    - The remaining count is compared against the limit.
    - If over limit, HTTP 429 is returned with a Retry-After header.

Rate limit tiers:
    - UPLOAD:     10 req/min per user (batch uploads)
    - AI_HEAVY:    5 req/min per user (recommendations, avatar, try-on)
    - READ:       60 req/min per user (wardrobe, calendar, history reads)
    - SSE:         2 concurrent per user (processing streams)
    - GLOBAL_AI:  60 req/min system-wide (Vertex AI quota protection)

Configuration:
    REDIS_URL          - Redis connection URL (default: redis://localhost:6379/0)
    RATE_LIMIT_ENABLED - Master switch to enable/disable (default: true)
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Optional

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from core.config import settings

_redis_client = None


class RateLimitTier(str, Enum):
    """Rate limit categories mapped to endpoint patterns."""

    UPLOAD = "upload"
    AI_HEAVY = "ai_heavy"
    READ = "read"
    SSE = "sse"
    AUTH = "auth"


TIER_LIMITS = {
    RateLimitTier.UPLOAD: {"max_requests": 10, "window_seconds": 60},
    RateLimitTier.AI_HEAVY: {"max_requests": 5, "window_seconds": 60},
    RateLimitTier.READ: {"max_requests": 60, "window_seconds": 60},
    RateLimitTier.SSE: {"max_requests": 2, "window_seconds": 60},
    RateLimitTier.AUTH: {"max_requests": 20, "window_seconds": 60},
}

GLOBAL_AI_LIMIT = {"max_requests": 60, "window_seconds": 60}
GLOBAL_CONCURRENT_AI = 20

ENDPOINT_TIER_MAP = {
    "/api/wardrobe/upload-batch": RateLimitTier.UPLOAD,
    "/api/wardrobe/retry-errors": RateLimitTier.UPLOAD,
    "/api/wardrobe/process": RateLimitTier.SSE,
    "/api/recommendations": RateLimitTier.AI_HEAVY,
    "/api/avatar": RateLimitTier.AI_HEAVY,
    "/api/tryon": RateLimitTier.AI_HEAVY,
    "/api/auth": RateLimitTier.AUTH,
}


def _get_redis():
    """Lazy-initialize and return the Redis async client.

    Uses connection pooling internally. Returns None if Redis
    is unavailable (rate limiting degrades gracefully).
    """
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    try:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=True,
        )
        return _redis_client
    except Exception as e:
        print(f"[RateLimit] Redis connection failed: {e}. Rate limiting disabled.")
        return None


def _classify_endpoint(path: str) -> RateLimitTier:
    """Determine the rate limit tier for a given request path.

    Matches the longest prefix in ENDPOINT_TIER_MAP. Falls back to
    READ tier for unmatched paths (most permissive for data reads).
    """
    for prefix, tier in sorted(ENDPOINT_TIER_MAP.items(), key=lambda x: -len(x[0])):
        if path.startswith(prefix):
            return tier
    return RateLimitTier.READ


async def _check_rate_limit(redis_client, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int, int]:
    """Check sliding window rate limit using Redis sorted sets.

    Args:
        redis_client: The async Redis client.
        key: The Redis key for this rate limit bucket.
        max_requests: Maximum allowed requests in the window.
        window_seconds: The sliding window duration in seconds.

    Returns:
        Tuple of (allowed: bool, remaining: int, retry_after: int).
    """
    now = time.time()
    window_start = now - window_seconds

    pipe = redis_client.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zcard(key)
    pipe.zadd(key, {f"{now}": now})
    pipe.expire(key, window_seconds + 10)

    results = await pipe.execute()
    current_count = results[1]

    if current_count >= max_requests:
        oldest = await redis_client.zrange(key, 0, 0, withscores=True)
        if oldest:
            retry_after = int(window_seconds - (now - oldest[0][1])) + 1
        else:
            retry_after = window_seconds
        await redis_client.zrem(key, f"{now}")
        return False, 0, retry_after

    remaining = max_requests - current_count - 1
    return True, remaining, 0


class RateLimitMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware that enforces per-user and global rate limits.

    Skipped for:
    - Health check endpoint
    - Development mode with RATE_LIMIT_ENABLED=false
    - When Redis is unavailable (graceful degradation)

    Adds rate limit headers to all responses:
    - X-RateLimit-Limit: max requests in window
    - X-RateLimit-Remaining: requests left
    - X-RateLimit-Reset: window reset time (unix timestamp)
    """

    async def dispatch(self, request: Request, call_next):
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        path = request.url.path

        # Skip non-API routes and health check
        if not path.startswith("/api") or path == "/health":
            return await call_next(request)

        redis_client = _get_redis()
        if redis_client is None:
            return await call_next(request)

        try:
            await redis_client.ping()
        except Exception:
            return await call_next(request)

        # Extract user_id from auth header or path
        user_id = self._extract_user_id(request, path)
        tier = _classify_endpoint(path)
        limits = TIER_LIMITS[tier]

        # Per-user rate limit
        user_key = f"ratelimit:{user_id}:{tier.value}"
        allowed, remaining, retry_after = await _check_rate_limit(
            redis_client, user_key, limits["max_requests"], limits["window_seconds"]
        )

        if not allowed:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Rate limit exceeded. Max {limits['max_requests']} requests per {limits['window_seconds']}s for {tier.value} operations.",
                    "retry_after": retry_after,
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limits["max_requests"]),
                    "X-RateLimit-Remaining": "0",
                },
            )

        # Global AI rate limit for heavy endpoints
        if tier == RateLimitTier.AI_HEAVY:
            global_key = "ratelimit:global:ai"
            g_allowed, g_remaining, g_retry = await _check_rate_limit(
                redis_client, global_key,
                GLOBAL_AI_LIMIT["max_requests"],
                GLOBAL_AI_LIMIT["window_seconds"],
            )
            if not g_allowed:
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "detail": "System AI capacity reached. Please try again shortly.",
                        "retry_after": g_retry,
                    },
                    headers={"Retry-After": str(g_retry)},
                )

        response = await call_next(request)

        response.headers["X-RateLimit-Limit"] = str(limits["max_requests"])
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + limits["window_seconds"])

        return response

    def _extract_user_id(self, request: Request, path: str) -> str:
        """Extract user identifier for rate limiting.

        Tries path segments first (most routes have /{user_id}/),
        falls back to IP address for unauthenticated requests.
        """
        parts = path.strip("/").split("/")
        # Pattern: /api/{resource}/{user_id}/...
        if len(parts) >= 3:
            return parts[2]
        # Fallback to client IP
        return request.client.host if request.client else "unknown"


async def cleanup_redis():
    """Close the Redis connection pool on shutdown."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.close()
        _redis_client = None
