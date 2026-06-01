from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class OutfitItem(BaseModel):
    item_id: str
    reason_for_pick: str


class RatingBreakdown(BaseModel):
    colour_harmony: float
    occasion_fit: float
    style_coherence: float


class OutfitRecommendation(BaseModel):
    rank: int
    outfit_name: str
    upper: OutfitItem
    lower: OutfitItem
    shoes: OutfitItem
    extra: Optional[OutfitItem] = None
    rating: float
    rating_breakdown: RatingBreakdown
    overall_reason: str


class RecommendationResponse(BaseModel):
    date: str
    occasion_tag: str
    recommendations: List[OutfitRecommendation]
    generated_at: datetime
    model_used: str
