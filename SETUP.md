# WardrobeAI — Developer Setup Guide

This guide walks you through setting up the WardrobeAI project from scratch on a new machine.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 18 | `brew install node` |
| Python | >= 3.10 | `brew install python@3.12` |
| Redis | >= 7 | `brew install redis` |
| Google Cloud CLI | latest | `brew install google-cloud-sdk` |

---

## 1. Google Cloud Platform (GCP) Setup

### 1.1 Create a GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Note your **Project ID** (e.g., `my-project-123456`)

### 1.2 Enable Required APIs

Go to **APIs & Services → Library** and enable:

| API | Purpose |
|-----|---------|
| **Vertex AI API** | Gemini models for clothing analysis, recommendations, avatar generation |
| **Cloud Firestore API** | Database for wardrobe items, history, recommendations |
| **Cloud Storage API** | Storing uploaded clothing images |
| **Geocoding API** | Location-based weather for outfit recommendations |
| **Identity Toolkit API** | Google Sign-In authentication |

```bash
# Or enable via CLI:
gcloud services enable \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  geocoding-backend.googleapis.com \
  identitytoolkit.googleapis.com \
  --project=YOUR_PROJECT_ID
```

### 1.3 Create a Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Name: `wardrobe-ai-backend`
4. Grant these roles:
   - `Vertex AI User` — for Gemini model access
   - `Cloud Datastore User` — for Firestore read/write
   - `Storage Object Admin` — for Cloud Storage uploads/downloads
5. Click **Done**
6. Click on the service account → **Keys** → **Add Key** → **Create new key** → **JSON**
7. Download the JSON key file
8. Rename it to `service-account.json` and place it in the `backend/` folder

> **IMPORTANT:** Never commit this file to git. It's already in `.gitignore`.

### 1.4 Create a Firestore Database

1. Go to **Firestore** in GCP Console
2. Click **Create Database**
3. Choose **Native mode**
4. Select a location (e.g., `asia-south1` for India)
5. Click **Create**

### 1.5 Create a Cloud Storage Bucket

1. Go to **Cloud Storage → Buckets**
2. Click **Create Bucket**
3. Name: e.g., `wardrobe_ai_cloth` (must be globally unique)
4. Location: same region as your project
5. Access: **Fine-grained**
6. Click **Create**
7. Go to **Permissions** → **Grant Access** → Add `allUsers` with role `Storage Object Viewer` (for public image URLs)

### 1.6 Create OAuth 2.0 Client ID (for Google Sign-In)

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `WardrobeAI Web Client`
5. **Authorized JavaScript origins:**
   - `http://localhost:5173` (dev frontend)
   - `http://localhost:3000` (alternative dev port)
   - Your production URL (when deployed)
6. **Authorized redirect URIs:**
   - `http://localhost:5173`
   - Your production URL (when deployed)
7. Click **Create**
8. Copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`)

> **Note:** After creating/editing the OAuth client, it may take 5-15 minutes for Google to propagate the changes.

### 1.7 Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User Type: **External** (or Internal if using Google Workspace)
3. Fill in app name, support email, etc.
4. Add scopes: `email`, `profile`, `openid`
5. Add your email to **Test users** (required while in "Testing" status)
6. Click **Save**

### 1.8 Get a Google Maps API Key

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → API Key**
3. Restrict the key:
   - **API restrictions:** Geocoding API only
   - **Application restrictions:** HTTP referrers (add your domains)
4. Copy the API key

---

## 2. Redis Setup

Redis is used for API rate limiting.

```bash
# Install
brew install redis

# Start (and auto-start at login)
brew services start redis

# Verify
redis-cli ping
# Should respond: PONG
```

Default URL: `redis://localhost:6379/0` (no password needed locally).

---

## 3. Environment Variables

### 3.1 Backend `.env`

Create `backend/.env`:

```env
# ─────────────────────────────────────────────────
# GCP — Service Account & Project
# ─────────────────────────────────────────────────
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GCP_PROJECT_ID=your-gcp-project-id
GCP_LOCATION=global

# ─────────────────────────────────────────────────
# Google Cloud Storage
# ─────────────────────────────────────────────────
GCS_BUCKET_NAME=your-bucket-name
GCS_BASE_URL=https://storage.googleapis.com/your-bucket-name

# ─────────────────────────────────────────────────
# Firestore
# ─────────────────────────────────────────────────
FIRESTORE_DATABASE=(default)

# ─────────────────────────────────────────────────
# Gemini Models (Vertex AI)
# ─────────────────────────────────────────────────
GEMINI_VISION_MODEL=gemini-2.5-flash
GEMINI_RECOMMENDATION_MODEL_FREE=gemini-2.5-flash-lite
GEMINI_RECOMMENDATION_MODEL_PREMIUM=gemini-2.5-flash

# ─────────────────────────────────────────────────
# Avatar Generation Model
# Choose one of:
#   gemini-2.5-flash-image (fast)
#   gemini-3.1-flash-image-preview (thinking capable)
#   gemini-3-pro-image-preview (highest quality)
# ─────────────────────────────────────────────────
GEMINI_AVATAR_MODEL=gemini-2.5-flash-image
GEMINI_AVATAR_VERTEX_LOCATION=global
GEMINI_AVATAR_TEMPERATURE=1.0
GEMINI_AVATAR_TOP_P=0.95
GEMINI_AVATAR_THINKING_ENABLED=false
GEMINI_AVATAR_THINKING_LEVEL=HIGH

# ─────────────────────────────────────────────────
# Ghost Mannequin — Dual Model Pipeline
# Two slots (A and B) run in parallel for virtual try-on
# ─────────────────────────────────────────────────
GEMINI_GHOST_MODEL_A=gemini-2.5-flash-image
GEMINI_GHOST_MODEL_B=gemini-3.1-flash-image-preview

# ─────────────────────────────────────────────────
# Parallel Processing
# ─────────────────────────────────────────────────
GEMINI_NJOBS=5

# ─────────────────────────────────────────────────
# Google Maps (Geocoding for weather-based recommendations)
# ─────────────────────────────────────────────────
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
GOOGLE_MAPS_GEOCODING_URL=https://maps.googleapis.com/maps/api/geocode/json

# ─────────────────────────────────────────────────
# Weather — Open-Meteo (free, no key needed)
# ─────────────────────────────────────────────────
OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1/forecast
WEATHER_FORECAST_DAYS=7

# ─────────────────────────────────────────────────
# Regional Defaults
# ─────────────────────────────────────────────────
DEFAULT_TIMEZONE=Asia/Kolkata
DEFAULT_COUNTRY=IN
DEFAULT_LANGUAGE=en
TEMP_UNIT=celsius
WIND_SPEED_UNIT=kmh
PRECIPITATION_UNIT=mm

# ─────────────────────────────────────────────────
# Google OAuth (for user sign-in)
# Get from: GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID
# ─────────────────────────────────────────────────
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com

# ─────────────────────────────────────────────────
# Redis (for rate limiting)
# ─────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379/0
RATE_LIMIT_ENABLED=true

# ─────────────────────────────────────────────────
# App Config
# ─────────────────────────────────────────────────
APP_ENV=development
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8000
DEFAULT_USER_ID=test-user-001
```

### 3.2 Frontend `.env`

Create `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_DEFAULT_USER_ID=test-user-001
VITE_GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
```

---

## 4. Install Dependencies

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

---

## 5. Run the Application

### Start Redis

```bash
brew services start redis
```

### Start Backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Start Frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 6. Summary of Credentials Needed

| Credential | Where to get it | Where to put it |
|-----------|----------------|-----------------|
| Service Account JSON | GCP → IAM → Service Accounts → Keys | `backend/service-account.json` |
| GCP Project ID | GCP Console → Project selector | `backend/.env` → `GCP_PROJECT_ID` |
| Cloud Storage Bucket Name | GCP → Cloud Storage → Buckets | `backend/.env` → `GCS_BUCKET_NAME` |
| Google Maps API Key | GCP → Credentials → API Keys | `backend/.env` → `GOOGLE_MAPS_API_KEY` |
| OAuth Client ID | GCP → Credentials → OAuth 2.0 | Both `backend/.env` and `frontend/.env` |

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| `GOOGLE_APPLICATION_CREDENTIALS` error | Ensure `service-account.json` exists in `backend/` |
| Google Sign-In "origin not allowed" | Add `http://localhost:5173` to OAuth client's Authorized JS Origins. Wait 5-15 min. |
| Redis connection refused | Run `brew services start redis` and verify with `redis-cli ping` |
| Firestore permission denied | Ensure service account has `Cloud Datastore User` role |
| Vertex AI quota exceeded | Reduce `GEMINI_NJOBS` or wait for quota reset |
| Avatar generation fails | Try a different model (change `GEMINI_AVATAR_MODEL`) |

---

## 8. GCP IAM Roles Quick Reference

Minimum roles for the service account:

```
roles/aiplatform.user          → Vertex AI (Gemini models)
roles/datastore.user           → Firestore read/write
roles/storage.objectAdmin      → Cloud Storage upload/download/delete
```

Optional (for production):

```
roles/logging.logWriter        → Cloud Logging
roles/monitoring.metricWriter  → Cloud Monitoring
```
