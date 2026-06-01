# WardrobeAI — AI-Powered Personal Wardrobe Manager

An intelligent wardrobe management application that uses Google Vertex AI (Gemini) to classify clothing, generate personalized outfit recommendations, create virtual try-ons, and provide body/colour science analysis tailored for Indian users.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                       │
│  Login → Wardrobe → Calendar → Outfits → History → Avatar          │
│  Google Sign-In │ Axios + Auth Header │ PWA + Responsive            │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ HTTPS (Bearer Token)
┌────────────────────────────────────▼────────────────────────────────┐
│                        Backend (FastAPI)                             │
│  Auth Middleware → Rate Limiter → Routes → Services                 │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │  Auth    │  │ Rate Limiter │  │  Gemini    │  │  Parallel   │  │
│  │(Google ID│  │   (Redis)    │  │  Service   │  │  Processor  │  │
│  │  Token)  │  │              │  │(httpx pool)│  │ (semaphore) │  │
│  └──────────┘  └──────────────┘  └────────────┘  └─────────────┘  │
└───────┬──────────────┬──────────────────┬───────────────┬───────────┘
        │              │                  │               │
   ┌────▼────┐   ┌────▼────┐      ┌──────▼──────┐  ┌────▼────┐
   │Firestore│   │  Redis  │      │  Vertex AI  │  │   GCS   │
   │(NoSQL)  │   │(Limits) │      │  (Gemini)   │  │(Images) │
   └─────────┘   └─────────┘      └─────────────┘  └─────────┘
```

---

## Features

### Core
- **AI Clothing Analysis** — Upload photos, get instant classification (category, color, pattern, fabric, fit, occasion tags, 20+ searchable attributes)
- **Ghost Mannequin** — Transforms clothing photos into professional product-catalog images
- **Weekly Calendar Planner** — Set occasion, dress code, and time-of-day per day
- **AI Outfit Recommendations** — Top 5 outfits per day considering wardrobe, weather, body profile, colour science, and recent history
- **Virtual Try-On** — See yourself wearing selected outfits using AI compositing
- **Body & Colour Analysis** — Full body type, skin tone, colour season, and personalised colour palette
- **Outfit History & Feedback** — Track what you wore, rate outfits, and the AI learns

### Infrastructure (Multi-User)
- **Google Sign-In** — OAuth 2.0 via Google Identity Services with dev-mode bypass
- **Redis Rate Limiting** — Sliding window per-user and global limits
- **Connection Pooling** — httpx.AsyncClient with concurrent connection management
- **User Isolation** — Middleware ensures users can only access their own data
- **PWA Support** — Installable, offline-capable, responsive on all devices

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Axios, Lucide Icons |
| Backend | Python 3.10+, FastAPI, Uvicorn |
| AI | Google Vertex AI (Gemini 2.5 Flash, Pro, Image models) |
| Database | Google Cloud Firestore (Native mode) |
| Storage | Google Cloud Storage |
| Auth | Google Identity Services (OAuth 2.0 ID Tokens) |
| Rate Limiting | Redis (sliding window) |
| Weather | Open-Meteo API (free) |
| Maps | Google Maps Geocoding API |

---

## Project Structure

```
wardrobe-ai/
├── backend/
│   ├── core/
│   │   ├── auth.py              # Google token verification & user isolation
│   │   ├── config.py            # Pydantic settings (reads .env)
│   │   ├── model_config.py      # AI model configurations
│   │   └── rate_limiter.py      # Redis-based rate limiting middleware
│   ├── routes/
│   │   ├── auth.py              # POST /api/auth/google, GET /api/auth/me
│   │   ├── wardrobe.py          # Clothing CRUD & AI analysis
│   │   ├── calendar.py          # Weekly calendar management
│   │   ├── recommendations.py   # AI outfit recommendations
│   │   ├── history.py           # Outfit history & feedback
│   │   ├── avatar.py            # Body/colour analysis & avatar generation
│   │   ├── tryon.py             # Virtual try-on
│   │   └── location.py          # Weather-based location services
│   ├── services/
│   │   ├── gemini_service.py    # Vertex AI client (httpx + semaphore)
│   │   ├── avatar_service.py    # Avatar & ghost mannequin generation
│   │   ├── firestore_service.py # Firestore CRUD operations
│   │   ├── storage_service.py   # GCS upload/download
│   │   ├── parallel_processor.py # Batch processing with concurrency
│   │   ├── tryon_service.py     # Virtual try-on pipeline
│   │   └── weather_service.py   # Open-Meteo weather integration
│   ├── main.py                  # FastAPI app entry point
│   ├── requirements.txt         # Python dependencies
│   └── firestore.indexes.json   # Recommended Firestore indexes
├── frontend/
│   ├── src/
│   │   ├── contexts/AuthContext.jsx  # Google Sign-In state management
│   │   ├── pages/
│   │   │   ├── Login.jsx        # Sign-in page
│   │   │   ├── Wardrobe.jsx     # Wardrobe management
│   │   │   ├── Calendar.jsx     # Calendar planner
│   │   │   ├── Outfits.jsx      # Outfit recommendations
│   │   │   ├── History.jsx      # Outfit history
│   │   │   └── Avatar.jsx       # Body analysis & avatar
│   │   ├── components/
│   │   │   ├── Navbar.jsx       # Top navigation
│   │   │   └── MobileNav.jsx    # Bottom tab bar (mobile)
│   │   ├── api/client.js        # Axios with auth interceptor
│   │   ├── App.jsx              # Root component with routing
│   │   └── index.css            # Global styles
│   ├── public/
│   │   ├── manifest.json        # PWA manifest
│   │   ├── sw.js                # Service worker
│   │   └── icons/               # PWA icons
│   ├── index.html               # Entry HTML
│   └── package.json             # Node dependencies
├── .gitignore                   # Protects credentials from being committed
├── SETUP.md                     # Detailed developer setup guide
└── README.md                    # This file
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/jatinnnbayer28-3/test.git
cd test

# 2. Backend setup
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Place your service-account.json in backend/
# Create backend/.env (see SETUP.md for all variables)

# 3. Frontend setup
cd ../frontend
npm install
# Create frontend/.env (see SETUP.md)

# 4. Start Redis
brew services start redis

# 5. Run backend
cd ../backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 6. Run frontend (new terminal)
cd ../frontend
npm run dev
```

Open http://localhost:5173 — use "Skip — Dev Mode" to bypass Google Sign-In during development.

---

## Setup Guide

See **[SETUP.md](./SETUP.md)** for the complete developer setup guide including:
- All GCP APIs to enable
- Service account creation & IAM roles
- OAuth 2.0 client configuration
- Every environment variable explained
- Redis installation
- Troubleshooting common issues

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/google` | Verify Google ID token & create user |
| GET | `/api/auth/me` | Get current user profile |
| GET | `/api/wardrobe/{user_id}` | List wardrobe items |
| POST | `/api/wardrobe/{user_id}/upload` | Upload & analyze clothing |
| DELETE | `/api/wardrobe/{user_id}/{item_id}` | Remove wardrobe item |
| GET | `/api/calendar/{user_id}` | Get weekly calendar |
| PUT | `/api/calendar/{user_id}/{date}` | Set day preferences |
| POST | `/api/recommendations/{user_id}/{date}` | Generate outfit recommendations |
| GET | `/api/history/{user_id}` | Get outfit history |
| POST | `/api/history/{user_id}` | Log worn outfit |
| POST | `/api/avatar/{user_id}/analyze` | Body & colour analysis |
| POST | `/api/avatar/{user_id}/generate` | Generate avatar image |
| POST | `/api/tryon/{user_id}` | Virtual try-on |
| GET | `/api/location/{user_id}/weather` | Get weather forecast |
| GET | `/health` | Health check |

All data endpoints require authentication in production. In development mode (`APP_ENV=development`), auth is bypassed.

---

## Rate Limits

| Tier | Requests | Window | Endpoints |
|------|----------|--------|-----------|
| Heavy | 10/min | 60s | Upload, recommendations, avatar, try-on |
| Standard | 30/min | 60s | Calendar, history, wardrobe list |
| Light | 60/min | 60s | Auth, health, location |

Rate limit headers are returned on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Environment Variables

See [SETUP.md](./SETUP.md) for the complete list with explanations.

**Backend** (`backend/.env`): 25+ variables for GCP, models, OAuth, Redis, app config.

**Frontend** (`frontend/.env`): 3 variables — backend URL, default user ID, Google Client ID.

---

## Development Notes

- **Dev Mode**: When `APP_ENV=development`, authentication is bypassed. The login page shows a "Skip — Dev Mode" button.
- **Google Sign-In**: Requires the OAuth client's Authorized JavaScript Origins to include `http://localhost:5173`. May take 5-15 minutes to propagate after adding.
- **Model Selection**: Avatar generation supports multiple Gemini image models. Change `GEMINI_AVATAR_MODEL` in `.env` to switch.
- **Rate Limiting**: Can be disabled by setting `RATE_LIMIT_ENABLED=false` in `.env`.

---

## License

Private project — not open source.
