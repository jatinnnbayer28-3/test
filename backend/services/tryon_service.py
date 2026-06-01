"""
Virtual Try-On Service — Vertex AI virtual-try-on-001
=====================================================
Combines upper + lower + shoes into a single column garment image (PNG),
then uses the genai SDK recontext_image with the user's avatar.
"""

import io
import time
import uuid
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
from PIL import Image as PILImage

from google import genai
from google.genai import types
from core.config import settings
from services import storage_service, firestore_service

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4)

PERSON_MAX_W = 768
GARMENT_COL_W = 384

# ── Eagerly create and warm up the client at module load ──
_genai_client = genai.Client(
    vertexai=True,
    project=settings.GCP_PROJECT_ID,
    location="global",
)


def _download_and_resize(image_url: str, max_w: int) -> PILImage.Image:
    img_bytes, _ = storage_service.download_image(image_url)
    img = PILImage.open(io.BytesIO(img_bytes)).convert("RGBA")
    if img.width > max_w:
        ratio = max_w / img.width
        img = img.resize((max_w, int(img.height * ratio)), PILImage.LANCZOS)
    return img


def _to_png_bytes(img: PILImage.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _combine_outfit_column(
    upper: PILImage.Image,
    lower: PILImage.Image,
    shoes: PILImage.Image,
) -> bytes:
    w = GARMENT_COL_W

    def fit(img):
        ratio = w / img.width
        return img.resize((w, int(img.height * ratio)), PILImage.LANCZOS)

    u, lo, s = fit(upper), fit(lower), fit(shoes)
    total_h = u.height + lo.height + s.height

    combined = PILImage.new("RGBA", (w, total_h), (255, 255, 255, 255))
    y = 0
    combined.paste(u, (0, y), u)
    y += u.height
    combined.paste(lo, (0, y), lo)
    y += lo.height
    combined.paste(s, (0, y), s)

    return _to_png_bytes(combined)


def _run_tryon_sync(person_png: bytes, garment_png: bytes) -> bytes:
    response = _genai_client.models.recontext_image(
        model="virtual-try-on-001",
        source=types.RecontextImageSource(
            person_image=types.Image(image_bytes=person_png, mime_type="image/png"),
            product_images=[
                types.ProductImage(
                    product_image=types.Image(image_bytes=garment_png, mime_type="image/png"),
                )
            ],
        ),
        config=types.RecontextImageConfig(number_of_images=1),
    )

    if not response.generated_images:
        raise RuntimeError("VTO model returned no images")

    return response.generated_images[0].image.image_bytes


async def virtual_tryon(
    user_id: str,
    upper_item_id: str,
    lower_item_id: str,
    shoes_item_id: str,
) -> str:
    t0 = time.perf_counter()
    loop = asyncio.get_event_loop()

    avatar_data, all_items = await asyncio.gather(
        firestore_service.get_avatar(user_id),
        firestore_service.get_all_clothing(user_id),
    )

    if not avatar_data:
        raise ValueError("No avatar found. Please create an avatar first.")
    avatar_url = avatar_data.get("avatar_url") or avatar_data.get("studio_url") or avatar_data.get("original_url")
    if not avatar_url:
        raise ValueError("Avatar image not found")

    item_map = {i["item_id"]: i for i in all_items}
    upper_item = item_map.get(upper_item_id)
    lower_item = item_map.get(lower_item_id)
    shoes_item = item_map.get(shoes_item_id)
    if not all([upper_item, lower_item, shoes_item]):
        raise ValueError("One or more clothing items not found in wardrobe")

    def _best_url(item):
        return item.get("segmented_url") or item.get("image_url")

    t1 = time.perf_counter()
    print(f"[TryOn] metadata: {t1 - t0:.1f}s")

    avatar_img, upper_img, lower_img, shoes_img = await asyncio.gather(
        loop.run_in_executor(_executor, _download_and_resize, avatar_url, PERSON_MAX_W),
        loop.run_in_executor(_executor, _download_and_resize, _best_url(upper_item), GARMENT_COL_W),
        loop.run_in_executor(_executor, _download_and_resize, _best_url(lower_item), GARMENT_COL_W),
        loop.run_in_executor(_executor, _download_and_resize, _best_url(shoes_item), GARMENT_COL_W),
    )

    t2 = time.perf_counter()
    print(f"[TryOn] download+resize: {t2 - t1:.1f}s")

    person_png = _to_png_bytes(avatar_img)
    garment_png = _combine_outfit_column(upper_img, lower_img, shoes_img)

    t3 = time.perf_counter()
    print(f"[TryOn] png: {t3 - t2:.1f}s | person={len(person_png)//1024}KB garment={len(garment_png)//1024}KB")

    result_bytes = await loop.run_in_executor(
        _executor, _run_tryon_sync, person_png, garment_png,
    )

    t4 = time.perf_counter()
    print(f"[TryOn] VTO model: {t4 - t3:.1f}s")

    def _upload(data: bytes) -> str:
        bucket = storage_service._get_bucket()
        blob_path = f"wardrobe/{user_id}/tryon_{uuid.uuid4().hex[:8]}.png"
        blob = bucket.blob(blob_path)
        blob.upload_from_string(data, content_type="image/png")
        try:
            blob.make_public()
        except Exception:
            pass
        return f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"

    result_url = await loop.run_in_executor(_executor, _upload, result_bytes)

    t5 = time.perf_counter()
    print(f"[TryOn] upload: {t5 - t4:.1f}s | TOTAL: {t5 - t0:.1f}s")

    return result_url
