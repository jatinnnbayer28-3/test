"""
Centralized Gemini Model Configuration
=======================================
Single source of truth for every Gemini model used across WardrobeAI.
Change a model ID here (or in .env) and it propagates everywhere.

Models are grouped by PURPOSE — each purpose maps to exactly one model at runtime,
resolved from Settings (which reads .env overrides).

Vertex AI REST API notes (tested May 2026):
  - `imageConfig` (aspectRatio, imageSize, outputMimeType) is NOT supported in
    the REST API — those are google.genai SDK-only fields.
  - `responseMimeType` is NOT supported for image generation.
  - `thinkingConfig` with `thinkingLevel` works only on Nano Banana 2
    (gemini-3.1-flash-image-preview). It is rejected by gemini-2.5-flash-image
    and gemini-3-pro-image-preview.
  - Global endpoint (aiplatform.googleapis.com) works for all three models.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from core.config import settings


# ── Model purpose tags ──────────────────────────────────────────────

class ModelPurpose(str, Enum):
    VISION = "vision"
    BODY_ANALYSIS = "body_analysis"
    RECOMMENDATION_FREE = "recommendation_free"
    RECOMMENDATION_PREMIUM = "recommendation_premium"
    AVATAR = "avatar"
    GHOST_A = "ghost_a"
    GHOST_B = "ghost_b"


# ── Per-model spec ──────────────────────────────────────────────────

@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    display_name: str
    purpose: ModelPurpose
    description: str

    supports_image_input: bool = True
    supports_image_output: bool = False
    supports_thinking: bool = False

    vertex_location: str = "global"

    default_temperature: float = 0.2
    default_max_tokens: int = 1024
    default_top_p: Optional[float] = None

    response_modalities: list[str] = field(default_factory=lambda: ["TEXT"])


# ── Registry ────────────────────────────────────────────────────────

def _build_registry() -> dict[ModelPurpose, ModelSpec]:
    """Build the model registry from current Settings values."""
    return {
        ModelPurpose.VISION: ModelSpec(
            model_id=settings.GEMINI_VISION_MODEL,
            display_name="Vision / Clothing Analyser",
            purpose=ModelPurpose.VISION,
            description=(
                "Fast multimodal model for clothing description and body analysis. "
                "Text-only output; thinking disabled for speed."
            ),
            supports_image_input=True,
            supports_image_output=False,
            supports_thinking=True,
            vertex_location=settings.GCP_LOCATION or "global",
            default_temperature=0.2,
            default_max_tokens=2048,
        ),

        ModelPurpose.BODY_ANALYSIS: ModelSpec(
            model_id=settings.GEMINI_BODY_ANALYSIS_MODEL,
            display_name="Body & Colour Analyser (Pro)",
            purpose=ModelPurpose.BODY_ANALYSIS,
            description=(
                "High-reasoning model for body proportion analysis and colour science. "
                "Uses gemini-2.5-pro for accurate colour recommendations."
            ),
            supports_image_input=True,
            supports_image_output=False,
            supports_thinking=True,
            vertex_location="global",
            default_temperature=0.3,
            default_max_tokens=8192,
        ),

        ModelPurpose.RECOMMENDATION_FREE: ModelSpec(
            model_id=settings.GEMINI_RECOMMENDATION_MODEL_FREE,
            display_name="Outfit Recommender (Free Tier)",
            purpose=ModelPurpose.RECOMMENDATION_FREE,
            description=(
                "Lightweight model for outfit recommendations on the free tier. "
                "Good balance of speed vs quality."
            ),
            supports_image_input=False,
            supports_image_output=False,
            supports_thinking=False,
            vertex_location=settings.GCP_LOCATION or "global",
            default_temperature=0.4,
            default_max_tokens=4096,
        ),

        ModelPurpose.RECOMMENDATION_PREMIUM: ModelSpec(
            model_id=settings.GEMINI_RECOMMENDATION_MODEL_PREMIUM,
            display_name="Outfit Recommender (Premium Tier)",
            purpose=ModelPurpose.RECOMMENDATION_PREMIUM,
            description=(
                "Higher-quality model for premium-tier outfit recommendations. "
                "Richer reasoning and more nuanced styling advice."
            ),
            supports_image_input=False,
            supports_image_output=False,
            supports_thinking=True,
            vertex_location=settings.GCP_LOCATION or "global",
            default_temperature=0.4,
            default_max_tokens=4096,
        ),

        ModelPurpose.AVATAR: ModelSpec(
            model_id=settings.GEMINI_AVATAR_MODEL,
            display_name="Avatar Generator",
            purpose=ModelPurpose.AVATAR,
            description=(
                "Image-generation model used for studio avatar portraits. "
                "Accepts a photo and returns an edited image with studio background. "
                "Supports IMAGE+TEXT response modalities via Vertex AI REST."
            ),
            supports_image_input=True,
            supports_image_output=True,
            supports_thinking=settings.GEMINI_AVATAR_THINKING_ENABLED,
            vertex_location=settings.GEMINI_AVATAR_VERTEX_LOCATION,
            default_temperature=settings.GEMINI_AVATAR_TEMPERATURE,
            default_max_tokens=8192,
            default_top_p=settings.GEMINI_AVATAR_TOP_P,
            response_modalities=["IMAGE", "TEXT"],
        ),

        ModelPurpose.GHOST_A: ModelSpec(
            model_id=settings.GEMINI_GHOST_MODEL_A,
            display_name="Ghost Mannequin — Slot A",
            purpose=ModelPurpose.GHOST_A,
            description="First image-gen model for ghost mannequin dual-model pipeline.",
            supports_image_input=True,
            supports_image_output=True,
            supports_thinking=False,
            vertex_location=settings.GCP_LOCATION or "global",
            default_temperature=1.0,
            default_max_tokens=8192,
            default_top_p=0.95,
            response_modalities=["IMAGE", "TEXT"],
        ),

        ModelPurpose.GHOST_B: ModelSpec(
            model_id=settings.GEMINI_GHOST_MODEL_B,
            display_name="Ghost Mannequin — Slot B",
            purpose=ModelPurpose.GHOST_B,
            description="Second image-gen model for ghost mannequin dual-model pipeline.",
            supports_image_input=True,
            supports_image_output=True,
            supports_thinking=False,
            vertex_location=settings.GCP_LOCATION or "global",
            default_temperature=1.0,
            default_max_tokens=8192,
            default_top_p=0.95,
            response_modalities=["IMAGE", "TEXT"],
        ),
    }


MODEL_REGISTRY: dict[ModelPurpose, ModelSpec] = _build_registry()


# ── Public helpers ──────────────────────────────────────────────────

def get_model(purpose: ModelPurpose) -> ModelSpec:
    """Return the ModelSpec for a given purpose."""
    return MODEL_REGISTRY[purpose]


def get_model_id(purpose: ModelPurpose) -> str:
    """Shortcut — return just the model ID string."""
    return MODEL_REGISTRY[purpose].model_id


def list_models() -> list[dict]:
    """Return a JSON-serialisable summary of every registered model."""
    return [
        {
            "purpose": spec.purpose.value,
            "model_id": spec.model_id,
            "display_name": spec.display_name,
            "description": spec.description,
            "supports_image_input": spec.supports_image_input,
            "supports_image_output": spec.supports_image_output,
            "supports_thinking": spec.supports_thinking,
            "vertex_location": spec.vertex_location,
            "temperature": spec.default_temperature,
            "max_tokens": spec.default_max_tokens,
            "top_p": spec.default_top_p,
            "response_modalities": spec.response_modalities,
        }
        for spec in MODEL_REGISTRY.values()
    ]
