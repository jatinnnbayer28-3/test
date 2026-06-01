from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


class ClothingItem(BaseModel):
    item_id: str
    image_url: str
    status: Literal["pending", "ready", "error"] = "pending"
    category: Optional[str] = None
    confidence: Optional[float] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    pattern: Optional[str] = None
    fit_type: Optional[str] = None
    fabric: Optional[str] = None
    neckline: Optional[str] = None
    sleeve_length: Optional[str] = None
    occasion_tags: Optional[List[str]] = None
    style_tags: Optional[List[str]] = None
    season: Optional[List[str]] = None
    dominant_tone: Optional[str] = None
    wear_position: Optional[str] = None
    short_description: Optional[str] = None
    added_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None


class CalendarDay(BaseModel):
    date: str
    occasion_tag: str
    dress_code: str
    time_of_day: str
    personal_note: Optional[str] = None
    weather: Optional[dict] = None
    saved_at: Optional[datetime] = None
