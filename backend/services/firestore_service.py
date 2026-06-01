"""
Firestore database service — all database operations for WardrobeAI.

Manages the following Firestore collections under users/{user_id}/:
- wardrobe/{item_id}        — clothing items with AI-generated metadata
- calendar/{date}           — daily occasion/dress code plans
- recommendations/{date}    — AI-generated outfit recommendations
- history/{date}            — worn outfit logs with feedback
- preferences/summary       — user style preferences (disliked patterns, etc.)
- profile/main              — location and geo data
- profile/avatar            — avatar images and body analysis
- profile/identity          — Google auth identity (added by auth routes)

Architecture:
- Uses a singleton AsyncClient for connection reuse across requests
- All operations are async for non-blocking I/O under load
- Data is scoped by user_id path prefix for isolation
- No cross-user queries exist (each user's data is independent)

Scaling (100 users):
- Firestore Native mode handles 10,000+ writes/sec out of the box
- No hot-spotting risk since doc IDs are user-specific UUIDs
- Composite indexes recommended for time-range queries (history, calendar)
"""

from datetime import datetime, timedelta
from typing import Optional, List
from google.cloud.firestore_v1 import AsyncClient
from core.config import settings

_db: AsyncClient = None


def get_db() -> AsyncClient:
    """Get or create the singleton Firestore async client.

    The client maintains its own gRPC channel pool internally,
    supporting high concurrency without explicit pooling.
    """
    global _db
    if _db is None:
        _db = AsyncClient(
            project=settings.GCP_PROJECT_ID,
            database=settings.FIRESTORE_DATABASE,
        )
    return _db


def init_db(client: AsyncClient):
    """Override the database client (used for testing with emulator)."""
    global _db
    _db = client


# ── Wardrobe ──

async def save_clothing_stub(user_id: str, item_id: str, image_url: str, wear_position: str = None) -> None:
    """Create a pending clothing item stub after image upload.

    Called immediately after the image is uploaded to GCS. The item
    stays in 'pending' status until AI processing completes.
    """
    db = get_db()
    ref = db.collection("users").document(user_id).collection("wardrobe").document(item_id)
    data = {
        "item_id": item_id,
        "image_url": image_url,
        "status": "pending",
        "added_at": datetime.utcnow(),
    }
    if wear_position:
        data["wear_position"] = wear_position
    await ref.set(data)


async def update_clothing_description(user_id: str, item_id: str, description_dict: dict) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("wardrobe").document(item_id)
    description_dict["status"] = "ready"
    description_dict["processed_at"] = datetime.utcnow()
    await ref.update(description_dict)


async def get_all_clothing(user_id: str) -> List[dict]:
    db = get_db()
    col = db.collection("users").document(user_id).collection("wardrobe")
    query = col.order_by("added_at", direction="DESCENDING")
    docs = []
    async for doc in query.stream():
        data = doc.to_dict()
        data["item_id"] = doc.id
        docs.append(data)
    return docs


async def get_pending_clothing(user_id: str) -> List[dict]:
    db = get_db()
    col = db.collection("users").document(user_id).collection("wardrobe")
    query = col.where("status", "==", "pending")
    docs = []
    async for doc in query.stream():
        data = doc.to_dict()
        data["item_id"] = doc.id
        docs.append(data)
    return docs


async def delete_clothing(user_id: str, item_id: str) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("wardrobe").document(item_id)
    await ref.delete()


async def patch_clothing(user_id: str, item_id: str, updates: dict) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("wardrobe").document(item_id)
    await ref.update(updates)


# ── Calendar ──

async def save_calendar_day(user_id: str, date: str, data: dict) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("calendar").document(date)
    data["saved_at"] = datetime.utcnow()
    await ref.set(data, merge=True)


async def get_week_calendar(user_id: str, start_date: str) -> List[dict]:
    db = get_db()
    from datetime import date as dt_date

    start = dt_date.fromisoformat(start_date)
    dates = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    results = []
    for d in dates:
        ref = db.collection("users").document(user_id).collection("calendar").document(d)
        snap = await ref.get()
        if snap.exists:
            data = snap.to_dict()
            data["date"] = d
            results.append(data)
        else:
            results.append({"date": d})
    return results


async def delete_calendar_day(user_id: str, date: str) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("calendar").document(date)
    await ref.delete()


# ── Recommendations ──

async def save_recommendations(user_id: str, date: str, data: dict) -> None:
    db = get_db()
    ref = (
        db.collection("users")
        .document(user_id)
        .collection("recommendations")
        .document(date)
    )
    await ref.set(data)


async def get_recommendations(user_id: str, date: str) -> Optional[dict]:
    db = get_db()
    ref = (
        db.collection("users")
        .document(user_id)
        .collection("recommendations")
        .document(date)
    )
    snap = await ref.get()
    return snap.to_dict() if snap.exists else None


# ── History ──

async def save_history(
    user_id: str, date: str, worn_item_ids: List[str], recommendation_id: str,
    occasion_tag: str = "", weather_snapshot: dict = None,
) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("history").document(date)
    data = {
        "date": date,
        "worn_item_ids": worn_item_ids,
        "recommendation_id": recommendation_id,
        "logged_at": datetime.utcnow(),
    }
    if occasion_tag:
        data["occasion_tag"] = occasion_tag
    if weather_snapshot:
        data["weather_snapshot"] = weather_snapshot
    await ref.set(data)


async def save_feedback(user_id: str, date: str, feedback: str, tags: Optional[List[str]]) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("history").document(date)
    await ref.update({
        "feedback": feedback,
        "feedback_tags": tags or [],
        "feedback_at": datetime.utcnow(),
    })


async def get_history(user_id: str, days: int = 30) -> List[dict]:
    db = get_db()
    col = db.collection("users").document(user_id).collection("history")
    cutoff = datetime.utcnow() - timedelta(days=days)
    query = col.where("logged_at", ">=", cutoff).order_by("logged_at", direction="DESCENDING")
    docs = []
    async for doc in query.stream():
        data = doc.to_dict()
        data["date"] = doc.id
        docs.append(data)
    return docs


# ── Preferences ──

async def get_preferences(user_id: str) -> dict:
    db = get_db()
    ref = (
        db.collection("users")
        .document(user_id)
        .collection("preferences")
        .document("summary")
    )
    snap = await ref.get()
    if snap.exists:
        return snap.to_dict()
    return {"disliked_patterns": [], "preferred_styles": []}


# ── Avatar ──

async def save_avatar(user_id: str, avatar_data: dict) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("profile").document("avatar")
    avatar_data["updated_at"] = datetime.utcnow()
    await ref.set(avatar_data, merge=True)


async def get_avatar(user_id: str) -> Optional[dict]:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("profile").document("avatar")
    snap = await ref.get()
    return snap.to_dict() if snap.exists else None


# ── Profile ──

async def save_profile(user_id: str, profile: dict) -> None:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("profile").document("main")
    await ref.set(profile, merge=True)


async def get_profile(user_id: str) -> Optional[dict]:
    db = get_db()
    ref = db.collection("users").document(user_id).collection("profile").document("main")
    snap = await ref.get()
    return snap.to_dict() if snap.exists else None
