"""
Authentication routes for Google Sign-In.

Provides the /api/auth/google endpoint that verifies a Google ID token
and creates or updates the user's identity profile in Firestore. This is
called by the frontend after a successful Google Sign-In flow.

The endpoint returns the user profile which the frontend uses to display
user info (name, picture) and to obtain the canonical user_id (Google sub).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.auth import AuthenticatedUser, get_current_user
from services import firestore_service

router = APIRouter(prefix="/auth", tags=["auth"])


class GoogleSignInRequest(BaseModel):
    """Request body for Google Sign-In endpoint (token passed via header)."""
    pass


class UserProfile(BaseModel):
    """Response model for authenticated user profile."""

    user_id: str
    email: str
    name: str
    picture: str | None = None
    created_at: str | None = None
    last_login: str | None = None


@router.post("/google", response_model=UserProfile)
async def google_sign_in(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Authenticate with Google and create/update user profile.

    This endpoint is called after the frontend obtains a Google ID token
    via Google Identity Services. The token is passed in the Authorization
    header and verified by the get_current_user dependency.

    On first login, a new user document is created in Firestore. On
    subsequent logins, the last_login timestamp is updated.

    Args:
        user: The verified user from the Authorization header.

    Returns:
        UserProfile with user_id, email, name, picture, timestamps.
    """
    db = firestore_service.get_db()
    profile_ref = (
        db.collection("users")
        .document(user.user_id)
        .collection("profile")
        .document("identity")
    )

    existing = await profile_ref.get()
    now = datetime.utcnow().isoformat()

    if existing.exists:
        await profile_ref.update({
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
            "last_login": now,
        })
        data = existing.to_dict()
        return UserProfile(
            user_id=user.user_id,
            email=user.email,
            name=user.name,
            picture=user.picture,
            created_at=data.get("created_at"),
            last_login=now,
        )
    else:
        profile_data = {
            "user_id": user.user_id,
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
            "created_at": now,
            "last_login": now,
        }
        await profile_ref.set(profile_data)
        return UserProfile(
            user_id=user.user_id,
            email=user.email,
            name=user.name,
            picture=user.picture,
            created_at=now,
            last_login=now,
        )


@router.get("/me", response_model=UserProfile)
async def get_me(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Return the currently authenticated user's profile.

    Useful for the frontend to check if the stored token is still valid
    and to refresh user display info.

    Args:
        user: The verified user from the Authorization header.

    Returns:
        UserProfile from Firestore, or a minimal profile if no Firestore
        doc exists yet.
    """
    db = firestore_service.get_db()
    profile_ref = (
        db.collection("users")
        .document(user.user_id)
        .collection("profile")
        .document("identity")
    )

    doc = await profile_ref.get()
    if doc.exists:
        data = doc.to_dict()
        return UserProfile(
            user_id=user.user_id,
            email=data.get("email", user.email),
            name=data.get("name", user.name),
            picture=data.get("picture", user.picture),
            created_at=data.get("created_at"),
            last_login=data.get("last_login"),
        )

    return UserProfile(
        user_id=user.user_id,
        email=user.email,
        name=user.name,
        picture=user.picture,
    )
