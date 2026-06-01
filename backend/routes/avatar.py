import asyncio
import io
import time
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, HTTPException
from services import avatar_service, storage_service, firestore_service
from core.model_config import get_model, ModelPurpose

router = APIRouter(prefix="/avatar", tags=["avatar"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/avif"}

_pool = ThreadPoolExecutor(max_workers=4)

MAX_DIMENSION = 1536


def _compress_image(image_bytes: bytes) -> tuple:
    """Resize large photos to max 1536px and convert to JPEG for faster Vertex AI upload."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= MAX_DIMENSION and len(image_bytes) < 500_000:
        return image_bytes, "image/jpeg"

    if max(w, h) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)
    return buf.getvalue(), "image/jpeg"


@router.post("/{user_id}")
async def create_avatar(
    user_id: str,
    file: UploadFile = File(...),
):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    t_start = time.time()
    original_bytes = await file.read()
    loop = asyncio.get_event_loop()

    compressed_bytes, compressed_mime = await loop.run_in_executor(
        _pool, _compress_image, original_bytes
    )
    print(f"[Avatar] Image: {len(original_bytes)//1024}KB → {len(compressed_bytes)//1024}KB")

    t0 = time.time()
    avatar_bytes, body_profile = await asyncio.gather(
        avatar_service.generate_avatar(compressed_bytes, compressed_mime),
        avatar_service.analyse_body(compressed_bytes, compressed_mime),
    )
    print(f"[Avatar] AI generation + analysis: {time.time() - t0:.1f}s")

    avatar_id = str(uuid4())

    t1 = time.time()
    original_url, avatar_url = await asyncio.gather(
        loop.run_in_executor(
            _pool, storage_service.upload_image, original_bytes, "avatar_original.png", user_id
        ),
        loop.run_in_executor(
            _pool, storage_service.upload_image, avatar_bytes, "avatar_studio.png", user_id
        ),
    )
    print(f"[Avatar] GCS upload (parallel): {time.time() - t1:.1f}s")

    avatar_spec = get_model(ModelPurpose.AVATAR)
    avatar_data = {
        "avatar_id": avatar_id,
        "original_url": original_url,
        "avatar_url": avatar_url,
        "body_profile": body_profile,
        "model_used": avatar_spec.model_id,
        "model_display_name": avatar_spec.display_name,
    }

    t2 = time.time()
    await firestore_service.save_avatar(user_id, avatar_data)
    print(f"[Avatar] Firestore save: {time.time() - t2:.1f}s")

    try:
        signed_original, signed_avatar = await asyncio.gather(
            loop.run_in_executor(_pool, storage_service.generate_signed_url, original_url),
            loop.run_in_executor(_pool, storage_service.generate_signed_url, avatar_url),
        )
    except Exception:
        signed_original = original_url
        signed_avatar = avatar_url

    print(f"[Avatar] Total: {time.time() - t_start:.1f}s")

    return {
        **avatar_data,
        "original_url": signed_original,
        "avatar_url": signed_avatar,
    }


@router.get("/{user_id}")
async def get_avatar(user_id: str):
    avatar = await firestore_service.get_avatar(user_id)
    if not avatar:
        return {"avatar": None}

    loop = asyncio.get_event_loop()
    for key in ("original_url", "avatar_url"):
        if avatar.get(key):
            try:
                avatar[key] = await loop.run_in_executor(
                    _pool, storage_service.generate_signed_url, avatar[key]
                )
            except Exception:
                pass

    return avatar
