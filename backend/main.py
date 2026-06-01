import os
import ssl
import traceback
from contextlib import asynccontextmanager

# ── Kill SSL certificate verification globally for EVERY transport ──
# stdlib ssl
ssl._create_default_https_context = ssl._create_unverified_context
_orig_create_default_context = ssl.create_default_context

def _unverified_context(*args, **kwargs):
    ctx = _orig_create_default_context(*args, **kwargs)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

ssl.create_default_context = _unverified_context

os.environ["PYTHONHTTPSVERIFY"] = "0"
os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""

# urllib3 (used by requests / google-auth / google-cloud-storage)
try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except Exception:
    pass

# requests — make every Session default to verify=False
try:
    import requests
    _orig_session_init = requests.Session.__init__

    def _patched_session_init(self, *a, **kw):
        _orig_session_init(self, *a, **kw)
        self.verify = False

    requests.Session.__init__ = _patched_session_init
except Exception:
    pass

# httpx — make sync/async clients default to verify=False
try:
    import httpx
    _orig_httpx_client_init = httpx.Client.__init__
    _orig_httpx_async_init = httpx.AsyncClient.__init__

    def _patched_httpx_init(self, *a, **kw):
        kw.setdefault("verify", False)
        _orig_httpx_client_init(self, *a, **kw)

    def _patched_httpx_async_init(self, *a, **kw):
        kw.setdefault("verify", False)
        _orig_httpx_async_init(self, *a, **kw)

    httpx.Client.__init__ = _patched_httpx_init
    httpx.AsyncClient.__init__ = _patched_httpx_async_init
except Exception:
    pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings

os.environ.setdefault(
    "GOOGLE_APPLICATION_CREDENTIALS",
    settings.GOOGLE_APPLICATION_CREDENTIALS,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services import firestore_service
    from services.gemini_service import close_http_client
    from core.rate_limiter import cleanup_redis

    firestore_service.get_db()

    print(f"WardrobeAI backend started [{settings.APP_ENV}]")
    print(f"  Rate limiting: {'ENABLED' if settings.RATE_LIMIT_ENABLED else 'DISABLED'}")
    print(f"  Auth mode: {'PRODUCTION' if settings.APP_ENV != 'development' else 'DEVELOPMENT (bypassed)'}")
    yield

    await close_http_client()
    await cleanup_redis()


app = FastAPI(
    title="WardrobeAI API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting middleware (must be added after CORS to ensure CORS headers are present)
from core.rate_limiter import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)

# User isolation middleware — ensures path user_id matches authenticated user (production only)
from core.auth import UserIsolationMiddleware
app.add_middleware(UserIsolationMiddleware)

from routes import (
    wardrobe_router,
    calendar_router,
    recommendations_router,
    history_router,
    location_router,
    avatar_router,
    tryon_router,
    auth_router,
)

# Auth router is public (no auth dependency on itself)
app.include_router(auth_router, prefix="/api")

# All data routers are protected by auth in production
app.include_router(wardrobe_router, prefix="/api")
app.include_router(calendar_router, prefix="/api")
app.include_router(recommendations_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(location_router, prefix="/api")
app.include_router(avatar_router, prefix="/api")
app.include_router(tryon_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.APP_ENV}


@app.get("/api/models")
async def list_models():
    """Return every registered Gemini model and its current config."""
    from core.model_config import list_models as _list
    return {"models": _list()}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"Unhandled error: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )
