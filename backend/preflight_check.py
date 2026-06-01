"""
WardrobeAI Pre-flight Check
============================
Tests every credential and API dependency one by one.
Run:  python preflight_check.py
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from datetime import datetime, timezone

import truststore
truststore.inject_into_ssl()

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

PASS = "\033[92m✔ PASS\033[0m"
FAIL = "\033[91m✘ FAIL\033[0m"
WARN = "\033[93m⚠ WARN\033[0m"
BOLD = "\033[1m"
RESET = "\033[0m"

results = []


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append({"name": name, "status": status, "detail": detail})
    icon = PASS if ok else FAIL
    print(f"  {icon}  {name}")
    if detail:
        print(f"         {detail}")


def record_warn(name, detail=""):
    results.append({"name": name, "status": "WARN", "detail": detail})
    print(f"  {WARN}  {name}")
    if detail:
        print(f"         {detail}")


def section(title):
    print(f"\n{BOLD}{'─'*50}")
    print(f"  {title}")
    print(f"{'─'*50}{RESET}")


# ═══════════════════════════════════════════════════
# 1. ENV VARIABLES
# ═══════════════════════════════════════════════════

def check_env_variables():
    section("1. Environment Variables")

    required = [
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GCP_PROJECT_ID",
        "GCS_BUCKET_NAME",
        "GCS_BASE_URL",
        "GOOGLE_MAPS_API_KEY",
    ]
    optional_with_defaults = [
        "GCP_LOCATION",
        "FIRESTORE_DATABASE",
        "GEMINI_VISION_MODEL",
        "GEMINI_RECOMMENDATION_MODEL_FREE",
        "GEMINI_RECOMMENDATION_MODEL_PREMIUM",
        "GEMINI_NJOBS",
        "GOOGLE_MAPS_GEOCODING_URL",
        "OPEN_METEO_BASE_URL",
        "WEATHER_FORECAST_DAYS",
        "DEFAULT_TIMEZONE",
        "DEFAULT_COUNTRY",
        "TEMP_UNIT",
        "WIND_SPEED_UNIT",
        "PRECIPITATION_UNIT",
        "APP_ENV",
        "FRONTEND_URL",
        "BACKEND_URL",
        "DEFAULT_USER_ID",
    ]

    for var in required:
        val = os.getenv(var, "")
        if val:
            record(f"ENV {var}", True, f"= {val[:60]}{'...' if len(val)>60 else ''}")
        else:
            record(f"ENV {var}", False, "MISSING — this is required")

    for var in optional_with_defaults:
        val = os.getenv(var, "")
        if val:
            record(f"ENV {var}", True, f"= {val}")
        else:
            record_warn(f"ENV {var}", "Not set, will use default")


# ═══════════════════════════════════════════════════
# 2. SERVICE ACCOUNT FILE
# ═══════════════════════════════════════════════════

def check_service_account():
    section("2. Service Account JSON")

    sa_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    if not sa_path:
        record("Service account path set", False, "GOOGLE_APPLICATION_CREDENTIALS is empty")
        return

    resolved = Path(sa_path)
    if not resolved.is_absolute():
        resolved = Path(__file__).parent / sa_path

    if not resolved.exists():
        record("Service account file exists", False, f"Not found at: {resolved}")
        return

    record("Service account file exists", True, str(resolved))

    try:
        with open(resolved) as f:
            sa = json.load(f)

        for field in ["type", "project_id", "private_key", "client_email"]:
            if field in sa:
                val = sa[field]
                if field == "private_key":
                    val = val[:40] + "..."
                record(f"SA field '{field}'", True, f"= {val}")
            else:
                record(f"SA field '{field}'", False, "MISSING from JSON")

        env_project = os.getenv("GCP_PROJECT_ID", "")
        if sa.get("project_id") == env_project:
            record("SA project_id matches GCP_PROJECT_ID", True)
        else:
            record(
                "SA project_id matches GCP_PROJECT_ID",
                False,
                f"SA={sa.get('project_id')} vs ENV={env_project}",
            )

    except json.JSONDecodeError as e:
        record("Service account JSON valid", False, str(e))


# ═══════════════════════════════════════════════════
# 3. GOOGLE AUTH — can we get a token?
# ═══════════════════════════════════════════════════

def check_google_auth():
    section("3. Google Cloud Authentication")

    try:
        from google.auth import default as google_default
        from google.auth.transport.requests import Request

        creds, project = google_default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        record("google.auth.default() succeeds", True, f"project={project}")

        creds.refresh(Request())
        record("Token refresh succeeds", True, f"token={creds.token[:20]}...")
    except Exception as e:
        record("Google auth", False, str(e))


# ═══════════════════════════════════════════════════
# 4. CLOUD STORAGE
# ═══════════════════════════════════════════════════

def check_gcs():
    section("4. Google Cloud Storage")

    bucket_name = os.getenv("GCS_BUCKET_NAME", "")
    if not bucket_name:
        record("GCS bucket name set", False)
        return

    try:
        from google.cloud import storage

        client = storage.Client(project=os.getenv("GCP_PROJECT_ID"))
        record("GCS client created", True)

        bucket = client.bucket(bucket_name)
        if bucket.exists():
            record(f"Bucket '{bucket_name}' exists", True)
        else:
            record(f"Bucket '{bucket_name}' exists", False, "Bucket not found — create it in GCP console")
            return

        test_blob = bucket.blob("_preflight_check_test.txt")
        test_blob.upload_from_string("preflight check", content_type="text/plain")
        record("Write to bucket", True, "Uploaded _preflight_check_test.txt")

        try:
            test_blob.make_public()
            record("Make blob public (per-object ACL)", True, f"URL: {test_blob.public_url}")
        except Exception as acl_err:
            if "uniform bucket-level access" in str(acl_err).lower():
                record_warn(
                    "Make blob public (per-object ACL)",
                    "Bucket uses Uniform access — OK if allUsers objectViewer is set at bucket level",
                )
            else:
                record("Make blob public", False, str(acl_err))

        public_url = f"https://storage.googleapis.com/{bucket_name}/_preflight_check_test.txt"
        record("Public URL format", True, public_url)

        test_blob.delete()
        record("Delete from bucket", True, "Cleaned up test file")

    except Exception as e:
        record("GCS access", False, str(e))


# ═══════════════════════════════════════════════════
# 5. FIRESTORE
# ═══════════════════════════════════════════════════

def check_firestore():
    section("5. Cloud Firestore")

    try:
        from google.cloud.firestore_v1 import AsyncClient

        db_name = os.getenv("FIRESTORE_DATABASE", "(default)")
        project = os.getenv("GCP_PROJECT_ID", "")

        async def _test():
            client = AsyncClient(project=project, database=db_name)

            test_ref = client.collection("_preflight_check").document("test")
            await test_ref.set({"checked_at": datetime.now(timezone.utc).isoformat(), "ok": True})
            record("Firestore write", True, f"database='{db_name}'")

            snap = await test_ref.get()
            if snap.exists:
                record("Firestore read", True, f"data={snap.to_dict()}")
            else:
                record("Firestore read", False, "Document not found after write")

            await test_ref.delete()
            record("Firestore delete", True, "Cleaned up test document")

            try:
                result = client.close()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

        asyncio.run(_test())

    except Exception as e:
        record("Firestore access", False, str(e))


# ═══════════════════════════════════════════════════
# 6. VERTEX AI — Gemini Vision Model
# ═══════════════════════════════════════════════════

def check_gemini():
    section("6. Gemini Models (Google Generative AI API)")

    vision_model_name = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash")
    rec_model_free = os.getenv("GEMINI_RECOMMENDATION_MODEL_FREE", "gemini-2.5-flash-lite")
    rec_model_premium = os.getenv("GEMINI_RECOMMENDATION_MODEL_PREMIUM", "gemini-2.5-flash")
    avatar_model = os.getenv("GEMINI_AVATAR_MODEL", "gemini-2.5-flash-image")

    try:
        import google.generativeai as genai
        import google.auth

        credentials, project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform",
                     "https://www.googleapis.com/auth/generative-language"]
        )
        genai.configure(credentials=credentials)
        record("genai.configure()", True, f"project={project}")
    except Exception as e:
        record("genai.configure()", False, str(e)[:200])
        return

    for label, model_name in [
        ("Vision model", vision_model_name),
        ("Rec model free", rec_model_free),
        ("Rec model premium", rec_model_premium),
        ("Avatar model", avatar_model),
    ]:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content("Respond with exactly: OK")
            text = response.text.strip()
            record(f"{label} ({model_name})", True, f"response='{text[:50]}'")
        except Exception as e:
            record(f"{label} ({model_name})", False, str(e)[:200])


# ═══════════════════════════════════════════════════
# 7. GOOGLE MAPS GEOCODING API
# ═══════════════════════════════════════════════════

def check_google_maps():
    section("7. Google Maps Geocoding API")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    geocoding_url = os.getenv(
        "GOOGLE_MAPS_GEOCODING_URL",
        "https://maps.googleapis.com/maps/api/geocode/json",
    )

    if not api_key:
        record("GOOGLE_MAPS_API_KEY set", False)
        return

    record("GOOGLE_MAPS_API_KEY set", True, f"= {api_key[:12]}...{api_key[-4:]}")

    try:
        import httpx

        # Test with Mumbai coordinates
        params = {
            "latlng": "19.076,72.8777",
            "key": api_key,
            "result_type": "locality",
        }
        resp = httpx.get(geocoding_url, params=params, timeout=10)
        data = resp.json()

        status = data.get("status", "UNKNOWN")
        if status == "OK":
            addr = data["results"][0]["formatted_address"] if data.get("results") else "N/A"
            record("Geocoding API call", True, f"status=OK, address={addr[:60]}")
        elif status == "REQUEST_DENIED":
            error_msg = data.get("error_message", "No details")
            record("Geocoding API call", False, f"REQUEST_DENIED: {error_msg}")
            print("         💡 Enable 'Geocoding API' in GCP Console → APIs & Services → Library")
        elif status == "INVALID_REQUEST":
            record("Geocoding API call", False, f"INVALID_REQUEST: check API key")
        else:
            record("Geocoding API call", False, f"status={status}, {data.get('error_message', '')}")

    except Exception as e:
        record("Geocoding API call", False, str(e))


# ═══════════════════════════════════════════════════
# 8. OPEN-METEO WEATHER API
# ═══════════════════════════════════════════════════

def check_open_meteo():
    section("8. Open-Meteo Weather API (free, no key)")

    base_url = os.getenv("OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast")

    try:
        import httpx

        params = {
            "latitude": 19.076,
            "longitude": 72.8777,
            "daily": "temperature_2m_max,temperature_2m_min,weathercode",
            "timezone": "Asia/Kolkata",
            "forecast_days": 2,
        }
        resp = httpx.get(base_url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        daily = data.get("daily", {})
        dates = daily.get("time", [])
        if dates:
            temps = daily.get("temperature_2m_max", [])
            record(
                "Open-Meteo API call",
                True,
                f"Got {len(dates)} days. {dates[0]}: max {temps[0]}°C",
            )
        else:
            record("Open-Meteo API call", False, "No daily data returned")

    except Exception as e:
        record("Open-Meteo API call", False, str(e))


# ═══════════════════════════════════════════════════
# 9. PYTHON DEPENDENCIES
# ═══════════════════════════════════════════════════

def check_dependencies():
    section("9. Python Dependencies")

    deps = [
        ("fastapi", "fastapi"),
        ("uvicorn", "uvicorn"),
        ("pydantic", "pydantic"),
        ("pydantic_settings", "pydantic-settings"),
        ("dotenv", "python-dotenv"),
        ("google.cloud.firestore_v1", "google-cloud-firestore"),
        ("google.cloud.storage", "google-cloud-storage"),
        ("google.auth", "google-auth"),
        ("vertexai", "vertexai"),
        ("httpx", "httpx"),
        ("PIL", "Pillow"),
        ("multipart", "python-multipart"),
    ]

    for module, pip_name in deps:
        try:
            __import__(module)
            record(f"import {module}", True)
        except ImportError:
            record(f"import {module}", False, f"pip install {pip_name}")


# ═══════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════

def print_summary():
    section("SUMMARY")

    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    warned = sum(1 for r in results if r["status"] == "WARN")
    total = len(results)

    print(f"\n  Total checks: {total}")
    print(f"  {PASS}  Passed:  {passed}")
    if warned:
        print(f"  {WARN}  Warnings: {warned}")
    if failed:
        print(f"  {FAIL}  Failed:  {failed}")

    if failed == 0:
        print(f"\n  {BOLD}\033[92m🚀 All checks passed! You're ready to run WardrobeAI.{RESET}")
    else:
        print(f"\n  {BOLD}\033[91m🛑 {failed} check(s) failed. Fix them before running the app.{RESET}")
        print(f"\n  Failed items:")
        for r in results:
            if r["status"] == "FAIL":
                print(f"    • {r['name']}: {r['detail']}")

    print()


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"\n{BOLD}{'═'*50}")
    print(f"  WardrobeAI — Pre-flight Credential Check")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'═'*50}{RESET}")

    check_env_variables()
    check_service_account()
    check_google_auth()
    check_dependencies()
    check_gcs()
    check_firestore()
    check_gemini()
    check_google_maps()
    check_open_meteo()
    print_summary()

    sys.exit(1 if any(r["status"] == "FAIL" for r in results) else 0)
