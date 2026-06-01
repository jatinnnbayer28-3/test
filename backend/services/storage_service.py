"""
Google Cloud Storage service — file upload, download, and URL management.

Manages all image storage for WardrobeAI in a single GCS bucket organized as:
    wardrobe/{user_id}/{uuid}_{filename}       — original clothing photos
    wardrobe/{user_id}/segmented_{item_id}.png — ghost mannequin product images
    wardrobe/{user_id}/avatar_{uuid}.png       — generated avatar images

Key features:
- Signed URLs with 2-hour expiry for secure client-side image loading
- User-scoped paths for data isolation
- Sync operations (GCS SDK is not async; called from thread pool in routes)

Scaling (100 users):
- GCS handles unlimited concurrent reads/writes
- Single bucket with user-prefix organization avoids hot-key issues
- Signed URLs offload bandwidth from the backend server
"""

import uuid
from datetime import timedelta
from urllib.parse import urlparse
from google.cloud import storage
from core.config import settings

_client: storage.Client = None
_bucket: storage.Bucket = None

SIGNED_URL_EXPIRY = timedelta(hours=2)


def _get_bucket() -> storage.Bucket:
    """Get or create the singleton GCS bucket reference.

    The storage.Client maintains its own connection pool internally.
    """
    global _client, _bucket
    if _bucket is None:
        _client = storage.Client(project=settings.GCP_PROJECT_ID)
        _bucket = _client.bucket(settings.GCS_BUCKET_NAME)
    return _bucket


def _blob_path_from_url(image_url: str) -> str:
    parsed = urlparse(image_url)
    path = parsed.path.lstrip("/")
    prefix = settings.GCS_BUCKET_NAME + "/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    return path


def upload_image(file_bytes: bytes, filename: str, user_id: str) -> str:
    bucket = _get_bucket()
    unique_name = f"{uuid.uuid4()}_{filename}"
    blob_path = f"wardrobe/{user_id}/{unique_name}"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(file_bytes, content_type=_guess_content_type(filename))
    try:
        blob.make_public()
    except Exception:
        pass
    return f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"


def download_image(image_url: str) -> tuple:
    """Download image bytes via authenticated GCS SDK (no public access needed)."""
    bucket = _get_bucket()
    blob_path = _blob_path_from_url(image_url)
    blob = bucket.blob(blob_path)
    data = blob.download_as_bytes()
    ct = blob.content_type or "image/jpeg"
    return data, ct


def generate_signed_url(image_url: str) -> str:
    """Generate a time-limited signed URL for a private GCS object."""
    bucket = _get_bucket()
    blob_path = _blob_path_from_url(image_url)
    blob = bucket.blob(blob_path)
    return blob.generate_signed_url(expiration=SIGNED_URL_EXPIRY, method="GET")


def delete_image(image_url: str) -> bool:
    try:
        bucket = _get_bucket()
        blob_path = _blob_path_from_url(image_url)
        blob = bucket.blob(blob_path)
        blob.delete()
        return True
    except Exception:
        return False


def _guess_content_type(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".avif"):
        return "image/avif"
    return "image/jpeg"
