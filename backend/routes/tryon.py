"""
Virtual try-on route — generate an AI composite of the user wearing selected clothes.

Endpoints:
    POST /api/tryon/{user_id}  — Combine avatar + upper + lower + shoes into try-on image

Uses Vertex AI virtual-try-on-001 model. Requires avatar to be generated first.
Rate limit: 5 req/min per user (AI_HEAVY tier).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.tryon_service import virtual_tryon
from services import storage_service

router = APIRouter(prefix="/tryon", tags=["tryon"])


class TryOnRequest(BaseModel):
    upper_item_id: str
    lower_item_id: str
    shoes_item_id: str


@router.post("/{user_id}")
async def try_on_outfit(user_id: str, body: TryOnRequest):
    try:
        result_url = await virtual_tryon(
            user_id=user_id,
            upper_item_id=body.upper_item_id,
            lower_item_id=body.lower_item_id,
            shoes_item_id=body.shoes_item_id,
        )

        try:
            signed_url = storage_service.generate_signed_url(result_url)
        except Exception:
            signed_url = result_url

        return {"tryon_url": signed_url, "raw_url": result_url}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Try-on failed: {str(e)}")
