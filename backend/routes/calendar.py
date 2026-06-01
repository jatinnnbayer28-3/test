"""
Calendar routes — weekly planner with occasion, dress code, and weather integration.

Endpoints:
    POST /api/calendar/{user_id}/{date}   — Save day plan (occasion, dress code, notes)
    GET  /api/calendar/{user_id}/week     — Get 7-day calendar with weather forecasts
    DELETE /api/calendar/{user_id}/{date}  — Delete a day's plan

Weather is automatically fetched if lat/lng are provided on save,
or from the user's saved location profile.
"""

from datetime import date as dt_date, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from services import firestore_service, weather_service
from core.config import settings

router = APIRouter(prefix="/calendar", tags=["calendar"])


class CalendarDayInput(BaseModel):
    occasion_tag: str
    dress_code: str
    time_of_day: str
    personal_note: Optional[str] = None


@router.post("/{user_id}/{date}")
async def save_calendar_day(
    user_id: str,
    date: str,
    body: CalendarDayInput,
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
):
    data = {
        "date": date,
        "occasion_tag": body.occasion_tag,
        "dress_code": body.dress_code,
        "time_of_day": body.time_of_day,
        "personal_note": body.personal_note,
    }

    if lat is not None and lng is not None:
        try:
            forecast = await weather_service.fetch_7day_forecast(lat, lng)
            day_weather = next((f for f in forecast if f["date"] == date), None)
            if day_weather:
                data["weather"] = day_weather
        except Exception:
            pass

    await firestore_service.save_calendar_day(user_id, date, data)
    return data


@router.get("/{user_id}/week")
async def get_week_calendar(
    user_id: str,
    start_date: Optional[str] = Query(None),
):
    if not start_date:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(settings.DEFAULT_TIMEZONE)
        start_date = datetime.now(tz).date().isoformat()

    days = await firestore_service.get_week_calendar(user_id, start_date)

    profile = await firestore_service.get_profile(user_id)
    if profile and profile.get("lat") and profile.get("lng"):
        try:
            forecast = await weather_service.fetch_7day_forecast(
                profile["lat"], profile["lng"]
            )
            weather_map = {f["date"]: f for f in forecast}
            for day in days:
                d = day.get("date")
                if d and d in weather_map and "weather" not in day:
                    day["weather"] = weather_map[d]
        except Exception:
            pass

    return days


@router.delete("/{user_id}/{date}")
async def delete_calendar_day(user_id: str, date: str):
    await firestore_service.delete_calendar_day(user_id, date)
    return {"deleted": True}
