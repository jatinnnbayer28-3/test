"""
History and feedback routes — track worn outfits and collect user preferences.

Endpoints:
    POST /api/history/{user_id}/{date}   — Log which outfit was worn
    POST /api/feedback/{user_id}/{date}  — Submit like/dislike + tags
    GET  /api/history/{user_id}          — Get recent outfit history
    GET  /api/stats/{user_id}            — Wear frequency statistics by position

Feedback loop: negative feedback updates user preferences (disliked patterns,
preferred styles) which influence future outfit recommendations.
"""

from collections import Counter
from typing import Optional, List
from fastapi import APIRouter, Query
from pydantic import BaseModel
from services import firestore_service, storage_service

router = APIRouter(tags=["history"])


class HistoryInput(BaseModel):
    worn_item_ids: List[str]
    recommendation_id: str


class FeedbackInput(BaseModel):
    feedback: str
    tags: Optional[List[str]] = None


@router.post("/history/{user_id}/{date}")
async def save_history(user_id: str, date: str, body: HistoryInput):
    calendar_days = await firestore_service.get_week_calendar(user_id, date)
    cal_day = next((d for d in calendar_days if d.get("date") == date), {})
    occasion_tag = cal_day.get("occasion_tag", "")
    weather = cal_day.get("weather", {})

    await firestore_service.save_history(
        user_id, date, body.worn_item_ids, body.recommendation_id,
        occasion_tag=occasion_tag, weather_snapshot=weather,
    )
    return {"saved": True}


@router.post("/feedback/{user_id}/{date}")
async def submit_feedback(user_id: str, date: str, body: FeedbackInput):
    await firestore_service.save_feedback(user_id, date, body.feedback, body.tags)

    if body.feedback == "disliked" and body.tags:
        prefs = await firestore_service.get_preferences(user_id)
        disliked = set(prefs.get("disliked_patterns", []))
        for tag in body.tags:
            disliked.add(tag)
        db = firestore_service.get_db()
        ref = (
            db.collection("users")
            .document(user_id)
            .collection("preferences")
            .document("summary")
        )
        await ref.set(
            {"disliked_patterns": list(disliked), **{k: v for k, v in prefs.items() if k != "disliked_patterns"}},
            merge=True,
        )

    return {"saved": True}


@router.get("/history/{user_id}")
async def get_history(user_id: str, days: int = Query(30)):
    entries = await firestore_service.get_history(user_id, days)
    all_items = await firestore_service.get_all_clothing(user_id)
    items_map = {i["item_id"]: i for i in all_items}

    enriched = []
    for entry in entries:
        worn = []
        for wid in entry.get("worn_item_ids", []):
            if wid in items_map:
                item = {**items_map[wid]}
                if item.get("image_url"):
                    try:
                        item["image_url"] = storage_service.generate_signed_url(item["image_url"])
                    except Exception:
                        pass
                worn.append(item)
            else:
                worn.append({"item_id": wid, "status": "deleted"})
        entry["worn_items"] = worn
        enriched.append(entry)

    return enriched


@router.get("/stats/{user_id}")
async def get_wear_stats(user_id: str, days: int = Query(36500)):
    """Return most-worn, 2nd-most-worn, and least-worn items by wear_position.

    days=7 → week, 15 → 15 days, 30 → month, 36500 → lifetime (default).
    """
    entries = await firestore_service.get_history(user_id, days)
    all_items = await firestore_service.get_all_clothing(user_id)
    items_map = {i["item_id"]: i for i in all_items}

    for key in list(items_map):
        item = items_map[key]
        if item.get("image_url"):
            try:
                items_map[key] = {**item, "image_url": storage_service.generate_signed_url(item["image_url"])}
            except Exception:
                pass

    all_worn_ids = [wid for e in entries for wid in e.get("worn_item_ids", [])]
    counts = Counter(all_worn_ids)

    position_counts: dict[str, list[tuple[str, int]]] = {}
    for item_id, count in counts.items():
        item = items_map.get(item_id)
        if not item:
            continue
        pos = item.get("wear_position", "unknown")
        position_counts.setdefault(pos, []).append((item_id, count))

    def _top_n(ranked, n):
        """Return top-n items with metadata."""
        results = []
        for item_id, count in ranked[:n]:
            item = items_map.get(item_id, {})
            results.append({
                "item_id": item_id,
                "count": count,
                "category": item.get("category"),
                "primary_color": item.get("primary_color"),
                "short_description": item.get("short_description"),
                "image_url": item.get("image_url"),
                "wear_position": item.get("wear_position"),
            })
        return results

    stats = {}
    for pos in ("upper", "lower", "footwear"):
        ranked = sorted(position_counts.get(pos, []), key=lambda x: x[1], reverse=True)
        stats[pos] = {
            "most_worn": _top_n(ranked, 1),
            "second_most_worn": _top_n(ranked[1:], 1),
            "least_worn": _top_n(ranked[-1:], 1) if len(ranked) > 1 else [],
        }

    return {
        "period_days": days,
        "total_outfits": len(entries),
        "stats": stats,
    }
