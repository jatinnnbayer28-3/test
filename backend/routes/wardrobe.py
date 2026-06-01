"""
Wardrobe routes — upload, process, browse, and manage clothing items.

Endpoints:
    POST /api/wardrobe/upload-batch/{user_id}  — Upload 1-20 clothing photos
    POST /api/wardrobe/retry-errors/{user_id}  — Reset errored items to pending
    GET  /api/wardrobe/process/{user_id}       — SSE stream: AI describe + ghost mannequin
    GET  /api/wardrobe/{user_id}               — List all items with signed URLs
    PATCH /api/wardrobe/{user_id}/{item_id}    — Update item fields
    DELETE /api/wardrobe/{user_id}/{item_id}   — Delete item + GCS blobs

Rate limits:
    - Upload: 10 req/min per user
    - Process (SSE): 2 concurrent per user
    - Read: 60 req/min per user
"""

import json
import asyncio
from uuid import uuid4
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from services import storage_service, firestore_service
from services.parallel_processor import process_pending_items_parallel
from models.clothing import ClothingItem

router = APIRouter(prefix="/wardrobe", tags=["wardrobe"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/avif"}


@router.post("/upload-batch/{user_id}")
async def upload_batch(
    user_id: str,
    files: List[UploadFile] = File(...),
    wear_positions: Optional[str] = Form(None),
):
    positions_list = []
    if wear_positions:
        try:
            positions_list = json.loads(wear_positions)
        except json.JSONDecodeError:
            positions_list = []

    for f in files:
        if f.content_type not in ALLOWED_MIME:
            raise HTTPException(
                status_code=400,
                detail=f"File {f.filename} has unsupported type {f.content_type}. Allowed: jpeg, png, webp",
            )

    # Read all file bytes upfront (must be done sequentially in async context)
    file_data = []
    for idx, f in enumerate(files):
        file_bytes = await f.read()
        pos = positions_list[idx] if idx < len(positions_list) else None
        file_data.append((f.filename, file_bytes, pos))

    loop = asyncio.get_event_loop()

    async def _upload_one(filename: str, file_bytes: bytes, pos: Optional[str]) -> dict:
        item_id = str(uuid4())
        # Run blocking GCS upload in thread pool so it doesn't freeze the event loop
        image_url = await loop.run_in_executor(
            None, storage_service.upload_image, file_bytes, filename, user_id
        )
        await firestore_service.save_clothing_stub(user_id, item_id, image_url, pos)
        try:
            display_url = storage_service.generate_signed_url(image_url)
        except Exception:
            display_url = image_url
        return {
            "item_id": item_id,
            "image_url": display_url,
            "status": "pending",
            "wear_position": pos,
        }

    # Upload all files in parallel
    results = await asyncio.gather(*[_upload_one(fn, fb, pos) for fn, fb, pos in file_data])
    return list(results)


@router.post("/retry-errors/{user_id}")
async def retry_errors(user_id: str):
    """Reset all items with status=error back to pending so they can be re-processed."""
    items = await firestore_service.get_all_clothing(user_id)
    reset_count = 0
    for item in items:
        if item.get("status") == "error":
            await firestore_service.patch_clothing(
                user_id, item["item_id"], {"status": "pending"}
            )
            reset_count += 1
    return {"reset": reset_count}


@router.get("/process/{user_id}")
async def process_wardrobe(user_id: str):
    pending = await firestore_service.get_pending_clothing(user_id)

    async def event_stream():
        if not pending:
            yield f"data: {json.dumps({'message': 'nothing to process'})}\n\n"
            return

        last_keepalive = asyncio.get_event_loop().time()
        async for result in process_pending_items_parallel(user_id, pending):
            yield f"data: {json.dumps(result, default=str)}\n\n"
            now = asyncio.get_event_loop().time()
            if now - last_keepalive > 15:
                yield ": keepalive\n\n"
                last_keepalive = now

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{user_id}")
async def get_wardrobe(user_id: str):
    items = await firestore_service.get_all_clothing(user_id)
    for item in items:
        if item.get("segmented_url"):
            try:
                item["segmented_url"] = storage_service.generate_signed_url(item["segmented_url"])
            except Exception:
                pass
            try:
                item["image_url"] = item["segmented_url"]
            except Exception:
                pass
        elif item.get("image_url"):
            try:
                item["image_url"] = storage_service.generate_signed_url(item["image_url"])
            except Exception:
                pass
    return items


@router.patch("/{user_id}/{item_id}")
async def patch_clothing(user_id: str, item_id: str, updates: dict):
    await firestore_service.patch_clothing(user_id, item_id, updates)
    return {"updated": True, "item_id": item_id}


@router.delete("/{user_id}/{item_id}")
async def delete_clothing(user_id: str, item_id: str):
    items = await firestore_service.get_all_clothing(user_id)
    target = next((i for i in items if i.get("item_id") == item_id), None)
    if target:
        if target.get("image_url"):
            storage_service.delete_image(target["image_url"])
        if target.get("segmented_url"):
            storage_service.delete_image(target["segmented_url"])
    await firestore_service.delete_clothing(user_id, item_id)
    return {"deleted": True}
