from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


class Settings(BaseSettings):
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    GCP_PROJECT_ID: str = ""
    GCP_LOCATION: str = "asia-south1"
    GCS_BUCKET_NAME: str = ""
    GCS_BASE_URL: str = ""
    FIRESTORE_DATABASE: str = "(default)"

    GEMINI_VISION_MODEL: str = "gemini-2.5-flash"
    GEMINI_BODY_ANALYSIS_MODEL: str = "gemini-2.5-pro"
    GEMINI_RECOMMENDATION_MODEL_FREE: str = "gemini-2.5-pro"
    GEMINI_RECOMMENDATION_MODEL_PREMIUM: str = "gemini-2.5-pro"
    GEMINI_AVATAR_MODEL: str = "gemini-2.5-flash-image"
    GEMINI_GHOST_MODEL_A: str = "gemini-2.5-flash-image"
    GEMINI_GHOST_MODEL_B: str = "gemini-3.1-flash-image-preview"
    GEMINI_NJOBS: int = Field(default=5)

    # Avatar generation tuning — override in .env to switch models/behaviour
    GEMINI_AVATAR_VERTEX_LOCATION: str = "global"
    GEMINI_AVATAR_TEMPERATURE: float = 1.0
    GEMINI_AVATAR_TOP_P: float = 0.95
    GEMINI_AVATAR_THINKING_ENABLED: bool = False
    GEMINI_AVATAR_THINKING_LEVEL: str = "HIGH"

    GOOGLE_MAPS_API_KEY: str = ""
    GOOGLE_MAPS_GEOCODING_URL: str = "https://maps.googleapis.com/maps/api/geocode/json"
    OPEN_METEO_BASE_URL: str = "https://api.open-meteo.com/v1/forecast"
    WEATHER_FORECAST_DAYS: int = Field(default=7)

    DEFAULT_TIMEZONE: str = "Asia/Kolkata"
    DEFAULT_COUNTRY: str = "IN"
    TEMP_UNIT: str = "celsius"
    WIND_SPEED_UNIT: str = "kmh"
    PRECIPITATION_UNIT: str = "mm"

    # Google OAuth (for user sign-in via Google Identity Services)
    GOOGLE_CLIENT_ID: str = ""

    # Redis (for rate limiting)
    REDIS_URL: str = "redis://localhost:6379/0"
    RATE_LIMIT_ENABLED: bool = True

    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:5173"
    BACKEND_URL: str = "http://localhost:8000"
    DEFAULT_USER_ID: str = "test-user-001"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
