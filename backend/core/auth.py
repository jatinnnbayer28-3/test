"""
Google OAuth2 ID token verification and user isolation for FastAPI.

This module provides:
1. A FastAPI dependency (get_current_user) that validates Google ID tokens
   sent via the Authorization header.
2. A user isolation middleware that ensures authenticated users can only
   access their own data (path user_id must match token sub).

Uses Google's public certificates (cached locally) to verify JWT signatures
without making a network call on every request.

Usage:
    from core.auth import get_current_user, AuthenticatedUser

    @router.get("/protected")
    async def protected(user: AuthenticatedUser = Depends(get_current_user)):
        ...

Environment:
    GOOGLE_CLIENT_ID  - The OAuth 2.0 client ID from GCP Console.
    APP_ENV           - When set to "development", auth is bypassed and a
                        dummy user (DEFAULT_USER_ID) is returned.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from cachetools import TTLCache
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from core.config import settings

_bearer_scheme = HTTPBearer(auto_error=False)

_token_cache: TTLCache = TTLCache(maxsize=256, ttl=300)

# Regex to extract user_id from API paths like /api/{resource}/{user_id}/...
_USER_PATH_PATTERN = re.compile(r"^/api/(?:wardrobe|calendar|recommendations|history|feedback|stats|location|avatar|tryon)/([^/]+)")


@dataclass
class AuthenticatedUser:
    """Represents a verified Google user extracted from an ID token."""

    user_id: str
    email: str
    name: str
    picture: Optional[str] = None


def _verify_google_token(token: str) -> dict:
    """Verify a Google ID token and return its payload.

    Results are cached for up to 5 minutes to avoid repeated crypto
    verification overhead for the same token.

    Args:
        token: The raw JWT string from the Authorization header.

    Returns:
        The decoded token payload dict containing sub, email, name, picture.

    Raises:
        HTTPException 401 if verification fails.
    """
    cached = _token_cache.get(token)
    if cached is not None:
        return cached

    try:
        payload = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired Google ID token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token issuer is not Google",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _token_cache[token] = payload
    return payload


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> AuthenticatedUser:
    """FastAPI dependency that extracts and verifies the authenticated user.

    In development mode (APP_ENV=development), authentication is bypassed
    and a dummy user is returned to allow testing without Google OAuth.

    In production, the Authorization header must contain a valid Google
    ID token. The user's Google `sub` claim becomes their `user_id` in
    the system.

    Returns:
        AuthenticatedUser with user_id, email, name, picture.

    Raises:
        HTTPException 401 if no valid token is provided (production only).
    """
    if settings.APP_ENV == "development":
        if credentials and credentials.credentials:
            try:
                payload = _verify_google_token(credentials.credentials)
                return AuthenticatedUser(
                    user_id=payload["sub"],
                    email=payload.get("email", ""),
                    name=payload.get("name", ""),
                    picture=payload.get("picture"),
                )
            except HTTPException:
                pass

        return AuthenticatedUser(
            user_id=settings.DEFAULT_USER_ID,
            email="dev@localhost",
            name="Dev User",
            picture=None,
        )

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide a Google ID token in the Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _verify_google_token(credentials.credentials)

    return AuthenticatedUser(
        user_id=payload["sub"],
        email=payload.get("email", ""),
        name=payload.get("name", ""),
        picture=payload.get("picture"),
    )


class UserIsolationMiddleware(BaseHTTPMiddleware):
    """Middleware that enforces user data isolation in production.

    Verifies that the user_id in the URL path matches the authenticated
    user's ID (from their Google token sub claim). This prevents users
    from accessing other users' wardrobes, calendars, or recommendations.

    In development mode, this check is skipped to allow easy testing
    with any user_id.

    Skipped for:
    - Non-API routes
    - Auth routes (/api/auth/*)
    - Health check
    - Model listing endpoint
    """

    async def dispatch(self, request: Request, call_next):
        # Skip in development mode
        if settings.APP_ENV == "development":
            return await call_next(request)

        path = request.url.path

        # Skip non-user-scoped endpoints
        if not path.startswith("/api") or path.startswith("/api/auth") or path in ("/health", "/api/models"):
            return await call_next(request)

        # Extract user_id from path
        match = _USER_PATH_PATTERN.match(path)
        if not match:
            return await call_next(request)

        path_user_id = match.group(1)

        # Verify token and compare
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header[7:]
        try:
            payload = _verify_google_token(token)
        except HTTPException as e:
            return JSONResponse(
                status_code=e.status_code,
                content={"detail": e.detail},
            )

        token_user_id = payload.get("sub", "")

        if path_user_id != token_user_id:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Access denied. You can only access your own data."},
            )

        return await call_next(request)
