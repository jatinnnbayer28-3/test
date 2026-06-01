"""
Location routes — set user location via reverse geocoding and fetch weather forecasts.

Endpoints:
    POST /api/location/{user_id}  — Reverse geocode lat/lng, save profile, return forecast
    GET  /api/location/{user_id}  — Get saved location profile with current forecast

Uses Google Maps Geocoding API to resolve coordinates into city, district,
state, and pin code. Weather is fetched from Open-Meteo (free, no key required).
"""

from datetime import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from services import firestore_service, weather_service

router = APIRouter(prefix="/location", tags=["location"])


class LocationInput(BaseModel):
    lat: float
    lng: float


@router.post("/{user_id}")
async def set_location(user_id: str, body: LocationInput):
    geo = await weather_service.reverse_geocode(body.lat, body.lng)
    profile_data = {
        "lat": body.lat,
        "lng": body.lng,
        "city": geo.get("city", ""),
        "district": geo.get("district", ""),
        "state": geo.get("state", ""),
        "pin_code": geo.get("pin_code", ""),
        "updated_at": datetime.utcnow().isoformat(),
    }
    await firestore_service.save_profile(user_id, profile_data)
    forecast = await weather_service.fetch_7day_forecast(body.lat, body.lng)
    return {"profile": profile_data, "forecast": forecast}


@router.get("/{user_id}")
async def get_location(user_id: str):
    profile = await firestore_service.get_profile(user_id)
    if not profile:
        return {"profile": None, "forecast": []}

    forecast = []
    if profile.get("lat") and profile.get("lng"):
        try:
            forecast = await weather_service.fetch_7day_forecast(
                profile["lat"], profile["lng"]
            )
        except Exception:
            pass

    return {"profile": profile, "forecast": forecast}
