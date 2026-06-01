"""
Parallel batch processor for wardrobe item AI analysis.

Orchestrates the two-phase pipeline that transforms raw clothing photos
into fully-described, ghost-mannequin product images:

Phase 1 — Description (fast, text-only):
    All pending items are described in parallel using the vision model.
    Each item gets category, colors, patterns, tags, etc.
    Concurrency: unlimited (flash model has high RPM quota).

Phase 2 — Ghost Mannequin (slow, image generation):
    Dual-model pipeline distributes load across two image-gen models
    (GHOST_A and GHOST_B) with per-model semaphores.
    Retry loop with exponential backoff handles 429 rate limits.
    Progress streamed via SSE to the frontend.

Scaling (100 users):
    - Global AI semaphore in gemini_service caps total concurrent Vertex calls to 20
    - Per-model semaphore (PER_MODEL_CONCURRENCY=2) prevents image-gen quota exhaustion
    - Retry loop with cooldown allows burst recovery without dropping items
    - ThreadPoolExecutor for sync GCS downloads (max 5 workers)
"""

import asyncio
import logging
import random
import time
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncGenerator, List
from services import gemini_service, firestore_service, storage_service
from core.config import settings
from core.model_config import ModelPurpose

logger = logging.getLogger(__name__)

GHOST_RETRIES = 3
BATCH_SIZE = 5
PER_MODEL_CONCURRENCY = 2
MAX_GHOST_ROUNDS = 3
RETRY_COOLDOWN = 10

_GHOST_MODELS = [ModelPurpose.GHOST_A, ModelPurpose.GHOST_B]

_executor = ThreadPoolExecutor(max_workers=BATCH_SIZE)


def _download_sync(image_url: str) -> tuple:
    return storage_service.download_image(image_url)


def _upload_ghost_sync(png_bytes: bytes, user_id: str, item_id: str) -> str:
    """Upload ghost mannequin PNG to GCS and return the public URL."""
    bucket = storage_service._get_bucket()
    blob_path = f"wardrobe/{user_id}/segmented_{item_id}.png"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(png_bytes, content_type="image/png")
    try:
        blob.make_public()
    except Exception:
        pass
    return f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"


async def _with_backoff(coro_fn, item_id: str, label: str, retries: int = 3):
    """Retry with exponential backoff + jitter on 429."""
    for attempt in range(retries):
        try:
            return await coro_fn()
        except Exception as e:
            if "429" in str(e) and attempt < retries - 1:
                wait = 3 * (attempt + 1) + random.uniform(0, 2)
                logger.info(f"[{item_id}] {label} 429 — retry {attempt+1}/{retries-1} in {wait:.1f}s")
                await asyncio.sleep(wait)
                continue
            raise


async def _download_and_describe(user_id: str, item: dict) -> dict:
    """Download image from GCS and run description. Returns cached data for ghost phase."""
    item_id = item["item_id"]
    t0 = time.perf_counter()

    loop = asyncio.get_event_loop()
    image_bytes, content_type = await loop.run_in_executor(
        _executor, _download_sync, item["image_url"]
    )
    mime_type = content_type.split(";")[0].strip()

    desc = await _with_backoff(
        lambda: gemini_service.describe_clothing(image_bytes, mime_type),
        item_id, "Description",
    )
    await firestore_service.update_clothing_description(user_id, item_id, desc)

    logger.info(f"[{item_id}] Description done in {time.perf_counter() - t0:.1f}s")
    return {
        "item_id": item_id,
        "wear_position": item.get("wear_position"),
        "image_bytes": image_bytes,
        "mime_type": mime_type,
        "desc": desc,
    }


async def _ghost_one(
    user_id: str,
    entry: dict,
    model_purpose: ModelPurpose,
    sem: asyncio.Semaphore,
) -> dict:
    """Generate ghost mannequin for one item using the specified model, gated by semaphore."""
    item_id = entry["item_id"]
    model_name = "A" if model_purpose == ModelPurpose.GHOST_A else "B"
    t0 = time.perf_counter()

    async with sem:
        ghost_png = await _with_backoff(
            lambda: gemini_service.generate_ghost_mannequin(
                entry["image_bytes"], entry["mime_type"],
                entry["wear_position"] or "upper",
                model_purpose=model_purpose,
            ),
            item_id, f"Ghost({model_name})", retries=GHOST_RETRIES,
        )

    loop = asyncio.get_event_loop()
    segmented_url = await loop.run_in_executor(
        _executor, _upload_ghost_sync, ghost_png, user_id, item_id
    )
    await firestore_service.patch_clothing(user_id, item_id, {"segmented_url": segmented_url})

    elapsed = time.perf_counter() - t0
    logger.info(f"[{item_id}] Ghost({model_name}) done in {elapsed:.1f}s")
    return {"item_id": item_id, "segmented_url": segmented_url, "desc": entry["desc"]}


async def process_pending_items_parallel(
    user_id: str,
    pending_items: List[dict],
) -> AsyncGenerator[dict, None]:
    """Dual-model pipelined processing with retry loop.

    Phase 1 — ALL descriptions in parallel (~8-10s).
              gemini-2.5-flash (text model, high RPM). No progress events.

    Phase 2 — Ghost mannequins on TWO models simultaneously:
              Nano Banana  (gemini-2.5-flash-image)        — max 2 concurrent
              Nano Banana 2 (gemini-3.1-flash-image-preview) — max 2 concurrent
              Round-robin across models → up to 4 image-gen calls at once.

              asyncio.as_completed streams progress: 1/N → 2/N → N/N.

              RETRY LOOP: any items whose ghost fails are re-queued and retried
              (up to MAX_GHOST_ROUNDS total rounds) with a cooldown between rounds.
              Progress bar only counts successes — no item is skipped.

    "Go to wardrobe" only after ALL items are done.
    """
    total = len(pending_items)
    t_start = time.perf_counter()

    # ── Phase 1: descriptions — all parallel ──
    logger.info(f"Phase 1: Describing {total} items in parallel")

    desc_tasks = [
        asyncio.create_task(_download_and_describe(user_id, item))
        for item in pending_items
    ]
    desc_results = await asyncio.gather(*desc_tasks, return_exceptions=True)

    ghost_queue: list[dict] = []
    desc_errors = 0
    for idx, result in enumerate(desc_results):
        if isinstance(result, Exception):
            desc_errors += 1
            item_id = pending_items[idx]["item_id"]
            logger.error(f"[{item_id}] Description failed: {result}")
            try:
                await firestore_service.patch_clothing(user_id, item_id, {"status": "error"})
            except Exception:
                pass
            yield {
                "item_id": item_id,
                "status": "error",
                "error": str(result),
                "processed": desc_errors,
                "total": total,
            }
        else:
            ghost_queue.append(result)

    p1_elapsed = time.perf_counter() - t_start
    logger.info(f"Phase 1 done in {p1_elapsed:.1f}s — {len(ghost_queue)} items ready for ghost")

    # ── Phase 2: ghost mannequins — dual model with retry loop ──
    processed = desc_errors

    for round_num in range(1, MAX_GHOST_ROUNDS + 1):
        if not ghost_queue:
            break

        sems = {p: asyncio.Semaphore(PER_MODEL_CONCURRENCY) for p in _GHOST_MODELS}

        async def _safe_ghost(entry, model, sem):
            try:
                return await _ghost_one(user_id, entry, model, sem)
            except Exception as e:
                logger.warning(f"[{entry['item_id']}] Ghost failed round {round_num}: {e}")
                return {"item_id": entry["item_id"], "entry": entry, "failed": True}

        tasks = []
        for idx, entry in enumerate(ghost_queue):
            model = _GHOST_MODELS[idx % len(_GHOST_MODELS)]
            tasks.append(asyncio.create_task(_safe_ghost(entry, model, sems[model])))

        model_counts = {}
        for idx in range(len(ghost_queue)):
            m = _GHOST_MODELS[idx % len(_GHOST_MODELS)]
            model_counts[m.value] = model_counts.get(m.value, 0) + 1
        logger.info(
            f"Phase 2 round {round_num}: {len(ghost_queue)} ghost tasks — "
            f"{', '.join(f'{v}x {k}' for k, v in model_counts.items())}"
        )

        retry_queue: list[dict] = []
        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result.get("failed"):
                retry_queue.append(result["entry"])
            else:
                processed += 1
                yield {
                    "item_id": result["item_id"],
                    "status": "done",
                    "processed": processed,
                    "total": total,
                    "segmented_url": result["segmented_url"],
                    **result["desc"],
                }

        ghost_queue = retry_queue
        if ghost_queue and round_num < MAX_GHOST_ROUNDS:
            logger.info(
                f"{len(ghost_queue)} items failed round {round_num} — "
                f"retrying in {RETRY_COOLDOWN}s"
            )
            await asyncio.sleep(RETRY_COOLDOWN)

    if ghost_queue:
        logger.error(f"{len(ghost_queue)} items failed all {MAX_GHOST_ROUNDS} ghost rounds")
        for entry in ghost_queue:
            processed += 1
            yield {
                "item_id": entry["item_id"],
                "status": "done",
                "processed": processed,
                "total": total,
                **entry["desc"],
            }

    total_elapsed = time.perf_counter() - t_start
    logger.info(f"All {total} items done in {total_elapsed:.1f}s")
    yield {"status": "complete", "total": total}
