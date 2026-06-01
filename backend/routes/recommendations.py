"""
Recommendation routes — AI outfit generation, outfit analysis, and shopping suggestions.

Endpoints:
    POST /api/recommendations/{user_id}/{date}          — Generate outfit recommendations
    GET  /api/recommendations/{user_id}/{date}          — Get cached recommendations
    POST /api/recommendations/{user_id}/week            — Batch week recommendations
    POST /api/recommendations/{user_id}/analyse-outfit  — Analyse a photo for suggestions
    POST /api/recommendations/{user_id}/shopping-suggestions — AI wardrobe gap analysis

Rate limits: 5 req/min per user (AI_HEAVY tier)

The recommendation engine considers:
- User's wardrobe items (upper + lower + footwear)
- Body/colour profile from avatar analysis
- Calendar occasion and dress code
- Live weather data
- Recent outfit history (to avoid repetition)
- User feedback preferences
"""

from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from services import firestore_service, gemini_service, weather_service
from services.weather_service import TIME_OF_DAY_TO_SLOT
from models.recommendation import RecommendationResponse

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


class RecommendationInput(BaseModel):
    avatar_profile: Optional[dict] = None


@router.post("/{user_id}/week")
async def generate_week_recommendations(
    user_id: str,
    start_date: str = Query(None),
    force_regenerate: bool = Query(False),
):
    """Generate outfit recommendations for all 7 days of the week.
    Ensures no outfit combination repeats more than twice across the week.
    Returns 3 suggestions per day initially."""
    today = start_date or datetime.utcnow().strftime("%Y-%m-%d")
    dates = [(datetime.strptime(today, "%Y-%m-%d") + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]

    all_items = await firestore_service.get_all_clothing(user_id)
    ready_items = [i for i in all_items if i.get("status") == "ready"]

    if len(ready_items) < 3:
        raise HTTPException(status_code=400, detail="Need at least 3 processed clothing items")

    has_upper = any(i.get("wear_position") == "upper" for i in ready_items)
    has_lower = any(i.get("wear_position") == "lower" for i in ready_items)
    has_footwear = any(i.get("wear_position") == "footwear" for i in ready_items)
    missing = []
    if not has_upper: missing.append("upper wear")
    if not has_lower: missing.append("lower wear")
    if not has_footwear: missing.append("footwear")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing wardrobe categories: {', '.join(missing)}")

    calendar_days_data = await firestore_service.get_week_calendar(user_id, today)
    cal_map = {d["date"]: d for d in calendar_days_data if d.get("occasion_tag")}

    profile = await firestore_service.get_profile(user_id)
    user_tier = profile.get("tier", "free") if profile else "free"
    location_info = {}
    if profile:
        location_info = {
            "city": profile.get("city", ""),
            "district": profile.get("district", ""),
            "state": profile.get("state", ""),
            "pin_code": profile.get("pin_code", ""),
        }

    avatar_profile = {}
    avatar_data = await firestore_service.get_avatar(user_id)
    if avatar_data and avatar_data.get("body_profile"):
        avatar_profile = avatar_data["body_profile"]

    preferences = await firestore_service.get_preferences(user_id)
    history_entries = await firestore_service.get_history(user_id, days=7)
    recent_worn = [entry.get("worn_item_ids", []) for entry in history_entries]

    wardrobe_simplified = [
        {
            "item_id": i["item_id"],
            "category": i.get("category"),
            "primary_color": i.get("primary_color"),
            "secondary_color": i.get("secondary_color"),
            "pattern": i.get("pattern"),
            "fit_type": i.get("fit_type"),
            "fabric": i.get("fabric"),
            "occasion_tags": i.get("occasion_tags", []),
            "style_tags": i.get("style_tags", []),
            "season": i.get("season", []),
            "dominant_tone": i.get("dominant_tone"),
            "wear_position": i.get("wear_position"),
            "short_description": i.get("short_description"),
        }
        for i in ready_items
    ]

    used_combos = []
    results = {}
    skipped = []

    for date in dates:
        cal_day = cal_map.get(date)
        if not cal_day or not cal_day.get("occasion_tag"):
            skipped.append(date)
            continue

        if not force_regenerate:
            existing = await firestore_service.get_recommendations(user_id, date)
            if existing and existing.get("recommendations"):
                recs = existing["recommendations"]
                for rec in recs:
                    combo_key = f"{rec.get('upper',{}).get('item_id')}|{rec.get('lower',{}).get('item_id')}|{rec.get('shoes',{}).get('item_id')}"
                    used_combos.append(combo_key)
                results[date] = existing
                continue

        weather = cal_day.get("weather", {})
        if not weather and profile and profile.get("lat") and profile.get("lng"):
            try:
                forecast = await weather_service.fetch_7day_forecast(profile["lat"], profile["lng"])
                weather = next((f for f in forecast if f["date"] == date), {})
            except Exception:
                weather = {}

        effective_weather = weather
        time_of_day = cal_day.get("time_of_day", "")
        slot_key = TIME_OF_DAY_TO_SLOT.get(time_of_day)
        if slot_key and isinstance(weather, dict):
            slot_data = weather.get("time_slots", {}).get(slot_key)
            if slot_data:
                effective_weather = {**weather, **slot_data}

        augmented_worn = list(recent_worn)
        for combo in used_combos:
            parts = combo.split("|")
            if len(parts) == 3:
                augmented_worn.append(parts)

        try:
            recs, model_name = await gemini_service.generate_outfit_recommendations(
                wardrobe_items=wardrobe_simplified,
                avatar_profile=avatar_profile,
                calendar_day=cal_day,
                weather=effective_weather,
                recent_worn=augmented_worn,
                preferences=preferences,
                user_tier=user_tier,
                location=location_info,
            )
        except Exception as e:
            skipped.append(date)
            continue

        combo_count = {}
        for c in used_combos:
            combo_count[c] = combo_count.get(c, 0) + 1

        filtered_recs = []
        for rec in recs:
            combo_key = f"{rec.get('upper',{}).get('item_id')}|{rec.get('lower',{}).get('item_id')}|{rec.get('shoes',{}).get('item_id')}"
            if combo_count.get(combo_key, 0) < 2:
                filtered_recs.append(rec)
                combo_count[combo_key] = combo_count.get(combo_key, 0) + 1
                used_combos.append(combo_key)

        if not filtered_recs and recs:
            filtered_recs = recs[:3]
            for rec in filtered_recs:
                combo_key = f"{rec.get('upper',{}).get('item_id')}|{rec.get('lower',{}).get('item_id')}|{rec.get('shoes',{}).get('item_id')}"
                used_combos.append(combo_key)

        for i, rec in enumerate(filtered_recs):
            rec["rank"] = i + 1

        result = {
            "date": date,
            "occasion_tag": cal_day["occasion_tag"],
            "recommendations": filtered_recs,
            "generated_at": datetime.utcnow().isoformat(),
            "model_used": model_name,
        }

        await firestore_service.save_recommendations(user_id, date, result)
        results[date] = result

    return {
        "generated": list(results.keys()),
        "skipped": skipped,
        "results": results,
    }


class ShoppingInput(BaseModel):
    categories: List[str] = ["upper", "lower", "footwear"]


@router.post("/{user_id}/analyse-outfit")
async def analyse_outfit(
    user_id: str,
    file: UploadFile = File(...),
    categories: str = Form("upper,lower,footwear"),
):
    """Analyse a photo and suggest generalised clothing that complements their look and wardrobe."""
    cat_list = [c.strip() for c in categories.split(",") if c.strip()]
    if not cat_list:
        raise HTTPException(status_code=400, detail="Select at least one category")

    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"

    all_items = await firestore_service.get_all_clothing(user_id)
    ready_items = [i for i in all_items if i.get("status") == "ready"]

    wardrobe_simplified = [
        {
            "category": i.get("category"),
            "primary_color": i.get("primary_color"),
            "pattern": i.get("pattern"),
            "fabric": i.get("fabric"),
            "dominant_tone": i.get("dominant_tone"),
            "wear_position": i.get("wear_position"),
            "short_description": i.get("short_description"),
        }
        for i in ready_items
    ]

    avatar_profile = {}
    avatar_data = await firestore_service.get_avatar(user_id)
    if avatar_data and avatar_data.get("body_profile"):
        avatar_profile = avatar_data["body_profile"]

    result = await gemini_service.analyse_outfit_photo(
        image_bytes=image_bytes,
        mime_type=mime_type,
        categories=cat_list,
        wardrobe_items=wardrobe_simplified,
        avatar_profile=avatar_profile,
    )
    return result


@router.post("/{user_id}/shopping-suggestions")
async def shopping_suggestions(
    user_id: str,
    body: ShoppingInput,
):
    """Suggest clothing to buy that suits the user's looks and complements their wardrobe."""
    cat_list = [c for c in body.categories if c in ("upper", "lower", "footwear")]
    if not cat_list:
        raise HTTPException(status_code=400, detail="Select at least one category")

    all_items = await firestore_service.get_all_clothing(user_id)
    ready_items = [i for i in all_items if i.get("status") == "ready"]

    wardrobe_simplified = [
        {
            "category": i.get("category"),
            "primary_color": i.get("primary_color"),
            "pattern": i.get("pattern"),
            "fabric": i.get("fabric"),
            "dominant_tone": i.get("dominant_tone"),
            "wear_position": i.get("wear_position"),
            "short_description": i.get("short_description"),
        }
        for i in ready_items
    ]

    avatar_profile = {}
    avatar_data = await firestore_service.get_avatar(user_id)
    if avatar_data and avatar_data.get("body_profile"):
        avatar_profile = avatar_data["body_profile"]

    result = await gemini_service.generate_shopping_suggestions(
        wardrobe_items=wardrobe_simplified,
        avatar_profile=avatar_profile,
        categories=cat_list,
    )
    return result


@router.post("/{user_id}/{date}")
async def generate_recommendations(
    user_id: str,
    date: str,
    body: Optional[RecommendationInput] = None,
    force_regenerate: bool = Query(False),
):
    if not force_regenerate:
        existing = await firestore_service.get_recommendations(user_id, date)
        if existing:
            return existing

    all_items = await firestore_service.get_all_clothing(user_id)
    ready_items = [i for i in all_items if i.get("status") == "ready"]

    if len(ready_items) < 3:
        raise HTTPException(
            status_code=400,
            detail="Need at least 3 processed clothing items",
        )

    has_upper = any(i.get("wear_position") == "upper" for i in ready_items)
    has_lower = any(i.get("wear_position") == "lower" for i in ready_items)
    has_footwear = any(i.get("wear_position") == "footwear" for i in ready_items)

    missing = []
    if not has_upper:
        missing.append("upper wear")
    if not has_lower:
        missing.append("lower wear")
    if not has_footwear:
        missing.append("footwear")

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing wardrobe categories: {', '.join(missing)}. Upload items for each category.",
        )

    calendar_days = await firestore_service.get_week_calendar(user_id, date)
    calendar_day = next((d for d in calendar_days if d.get("date") == date and d.get("occasion_tag")), None)

    if not calendar_day or not calendar_day.get("occasion_tag"):
        raise HTTPException(status_code=400, detail="No occasion set for this date")

    weather = calendar_day.get("weather")
    if not weather:
        profile = await firestore_service.get_profile(user_id)
        if profile and profile.get("lat") and profile.get("lng"):
            try:
                forecast = await weather_service.fetch_7day_forecast(
                    profile["lat"], profile["lng"]
                )
                weather = next((f for f in forecast if f["date"] == date), {})
            except Exception:
                weather = {}
        else:
            weather = {}

    history_entries = await firestore_service.get_history(user_id, days=7)
    recent_worn = [entry.get("worn_item_ids", []) for entry in history_entries]

    preferences = await firestore_service.get_preferences(user_id)

    profile = await firestore_service.get_profile(user_id)
    user_tier = profile.get("tier", "free") if profile else "free"

    location_info = {}
    if profile:
        location_info = {
            "city": profile.get("city", ""),
            "district": profile.get("district", ""),
            "state": profile.get("state", ""),
            "pin_code": profile.get("pin_code", ""),
        }

    avatar_profile = {}
    if body and body.avatar_profile:
        avatar_profile = body.avatar_profile
    if not avatar_profile:
        avatar_data = await firestore_service.get_avatar(user_id)
        if avatar_data and avatar_data.get("body_profile"):
            avatar_profile = avatar_data["body_profile"]

    wardrobe_simplified = [
        {
            "item_id": i["item_id"],
            "category": i.get("category"),
            "primary_color": i.get("primary_color"),
            "secondary_color": i.get("secondary_color"),
            "pattern": i.get("pattern"),
            "fit_type": i.get("fit_type"),
            "fabric": i.get("fabric"),
            "occasion_tags": i.get("occasion_tags", []),
            "style_tags": i.get("style_tags", []),
            "season": i.get("season", []),
            "dominant_tone": i.get("dominant_tone"),
            "wear_position": i.get("wear_position"),
            "short_description": i.get("short_description"),
        }
        for i in ready_items
    ]

    effective_weather = weather
    time_of_day = calendar_day.get("time_of_day", "")
    slot_key = TIME_OF_DAY_TO_SLOT.get(time_of_day)
    if slot_key and isinstance(weather, dict):
        slot_data = weather.get("time_slots", {}).get(slot_key)
        if slot_data:
            effective_weather = {**weather, **slot_data}

    recs, model_name = await gemini_service.generate_outfit_recommendations(
        wardrobe_items=wardrobe_simplified,
        avatar_profile=avatar_profile,
        calendar_day=calendar_day,
        weather=effective_weather,
        recent_worn=recent_worn,
        preferences=preferences,
        user_tier=user_tier,
        location=location_info,
    )

    result = {
        "date": date,
        "occasion_tag": calendar_day["occasion_tag"],
        "recommendations": recs,
        "generated_at": datetime.utcnow().isoformat(),
        "model_used": model_name,
    }

    await firestore_service.save_recommendations(user_id, date, result)
    return result


@router.get("/{user_id}/{date}")
async def get_recommendations(user_id: str, date: str):
    result = await firestore_service.get_recommendations(user_id, date)
    if not result:
        raise HTTPException(status_code=404, detail="No recommendations found for this date")
    return result
