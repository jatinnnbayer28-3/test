"""
Avatar generation and body analysis service.

This module provides two core functions:
1. generate_avatar() — Transforms a user photo into a studio-quality avatar
   with white background, neutral pose, and proper framing using Gemini
   image generation models.

2. analyse_body() — Performs detailed body proportion, skin tone, and colour
   analysis using the Gemini pro reasoning model. Returns structured data
   for personalized outfit recommendations.

Architecture:
- Uses the shared httpx.AsyncClient from gemini_service for connection pooling
- Gated by the global AI semaphore (MAX_CONCURRENT_AI_JOBS=20)
- Falls back to flash model if pro model JSON parsing fails
- Thread-safe credential management shared with gemini_service
"""

import json
import re
import base64
import asyncio
import warnings
import httpx
from google.oauth2 import service_account
from google.auth.transport.requests import Request as AuthRequest
from core.config import settings
from core.model_config import get_model, ModelPurpose
from services.gemini_service import _get_http_client, _ai_semaphore, _get_token

warnings.filterwarnings("ignore")


def _repair_json(text: str) -> dict:
    """Robustly parse LLM JSON output, handling markdown fences, comments, and trailing commas."""
    if "```" in text:
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r',\s*([}\]])', r'\1', text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'\{[\s\S]*\}', text)
    if json_match:
        extracted = json_match.group()
        extracted = re.sub(r',\s*([}\]])', r'\1', extracted)
        try:
            return json.loads(extracted)
        except json.JSONDecodeError:
            pass

    text_fixed = re.sub(r"(?<!\\)'", '"', text)
    text_fixed = re.sub(r',\s*([}\]])', r'\1', text_fixed)
    try:
        return json.loads(text_fixed)
    except json.JSONDecodeError:
        pass

    try:
        import ast
        return ast.literal_eval(text)
    except (ValueError, SyntaxError):
        pass

    raise json.JSONDecodeError(f"Could not parse model output (length={len(text)})", text, 0)


def _vertex_url(model: str, location: str = "global", method: str = "generateContent") -> str:
    """Build Vertex AI endpoint URL for the specified model and location."""
    if location == "global":
        return (
            f"https://aiplatform.googleapis.com/v1/"
            f"projects/{settings.GCP_PROJECT_ID}/locations/global/"
            f"publishers/google/models/{model}:{method}"
        )
    return (
        f"https://{location}-aiplatform.googleapis.com/v1/"
        f"projects/{settings.GCP_PROJECT_ID}/locations/{location}/"
        f"publishers/google/models/{model}:{method}"
    )


AVATAR_BG_REMOVAL_PROMPT = """THIS IS AN IMAGE EDIT — NOT A NEW GENERATION.
The uploaded photo is the identity master. Edit only what is listed below. 
Everything not listed must remain pixel-identical to the original.

━━━ FACE — ABSOLUTE FREEZE ━━━
The face is completely frozen. Zero changes permitted.

Facial expression: IDENTICAL to reference. Do not relax, soften, 
 neutralize, or alter the expression in any way — not even 1%.
Facial structure: identical bone geometry, jawline, chin, nose, lips.
Eyes: identical shape, eyelid fold, iris color, gaze direction.
Skin: identical tone, texture, pores — no smoothing, no filter, 
 no retouching, no brightening.
Hair: identical color, texture, style.
The face must be a pixel-accurate copy of the reference. 
 If the face changes, the output is wrong.
━━━ WHAT TO EDIT ━━━

BACKGROUND: Remove completely. Replace with pure white (#FFFFFF).
  Pixel-perfect edge masking — preserve hair strands and clothing edges.
  No halo, no fringe. Clean white only — no gradient, no texture.

POSTURE: Change body to neutral straight standing pose only.
  - Both legs fully straight, not bent, firmly on the ground.
  - Feet flat, slightly apart (shoulder-width), toes angled naturally outward.
  - Arms hanging relaxed at sides.
  - Shoulders level, spine straight, head upright.
  - Natural, anatomically correct — no distortion.
  Do NOT change the face, head angle, or expression while adjusting posture.

SHOES: 
  - If shoes are visible in the reference: keep them exactly as-is.
  - If no shoes visible: add clean simple shoes matching the outfit.
   Casual outfit → clean white sneakers.
   Formal outfit → black/brown leather shoes.
   Dress/feminine → nude or white flats.
  Shoes must be photorealistic, correctly scaled, grounded naturally.

CENTERING: Place subject perfectly centered in frame — equal white 
  space on left, right, top (above head), and bottom (below shoes).
  Full body visible — head to shoes, nothing cropped.
  Portrait orientation 2:3 ratio.

GROUND SHADOW: Soft diffused contact shadow under the shoes only.
  25–30% opacity, cool grey, fading outward. No wall shadows.

LIGHTING: Soft even studio softbox lighting. No harsh shadows on body.
  Sharp focus head to shoes. Photorealistic commercial catalog quality.

━━━ DO NOT ━━━
Do not change face — highest priority, non-negotiable.
Do not change expression — even slightly.
Do not change skin tone or apply any skin filter.
Do not change clothing colors or outfit.
Do not bend legs or create a dynamic pose.
Do not crop any part of the body.
Do not add text, watermarks, or extra elements.
Do not use artistic or painterly effects.
Do not change hair color or style.""".strip()


BODY_ANALYSIS_PROMPT = """You are an elite personal stylist, body proportion analyst, and colour science expert specialising in Indian clients.

THINK DEEPLY before answering. Use your reasoning ability to:
1. Sample this person's exact skin tone from the photo and determine their Fitzpatrick type, Munsell value, and undertone.
2. Cross-reference their undertone + skin depth + contrast level to derive precise colour recommendations using established colour theory (Itten's colour wheel, simultaneous contrast, complementary harmony).
3. Verify every hex code is visually distinct from their skin and creates flattering contrast.

LOOK AT THIS PHOTO CAREFULLY. Analyse this specific person's skin tone, undertone, hair, eyes, body shape, and proportions from the image.
Focus ONLY on details that directly affect outfit selection, colour matching, and fit recommendations.

## COLOUR SCIENCE FRAMEWORK — INDIAN SKIN BRIGHTNESS FOCUS (apply rigorously)

### CORE PRINCIPLE: Pick colours that make THIS person's face look BRIGHTER, more radiant, and glowing.
Colours near the face create optical effects — the right colour reflects light onto the face making skin appear luminous and fairer. The wrong colour absorbs light and makes skin look dull/darker.

### Step 1 — Determine skin properties from the photo:
- Sample skin_tone_hex from face/neck (avoid shadows or highlights)
- Classify Fitzpatrick type (III–VI for most Indians)
- Determine undertone by checking vein colour (green=warm, blue=cool, mixed=neutral), how gold vs silver looks against skin
- Assess Munsell value (lightness): low value = deep skin, high value = fair skin

### Step 2 — BRIGHTNESS RULES for Indian skin:
UNIVERSAL BRIGHTENERS (work on nearly all Indian skin tones):
  - Bright white (#FFFFFF) and off-white (#FFF8F0) — reflects maximum light onto face
  - Pastel pink (#FFB6C1), soft peach (#FFDAB9), lavender (#E6E6FA) — soft luminous glow
  - Sky blue (#87CEEB), powder blue (#B0E0E6) — lifts warm/olive undertones
  - Mint (#98FF98), soft coral (#F88379) — freshens complexion
  - Light lemon (#FFFACD), cream (#FFFDD0) — warm glow without washing out

FOR WARM UNDERTONES (golden/yellow/peach — most common in Indians):
  - BRIGHTENING picks: soft coral, peach, warm pink, ivory, light turquoise, pastel yellow, warm lavender
  - Also flattering: teal (#008080), wine (#722F37), emerald (#046307), royal blue (#4169E1)
  - AVOID (makes skin dull): muddy olive, dull khaki, washed-out grey, mustard-yellow too close to skin tone, brown tones that blend with skin

FOR COOL UNDERTONES (pink/blue/red):
  - BRIGHTENING picks: icy blue, lilac, rose pink, soft magenta, baby blue, silvery white, cool mint
  - Also flattering: sapphire (#0F52BA), ruby (#9B111E), plum (#673147), emerald
  - AVOID: warm yellow, orange, camel, warm brown — makes skin look sallow/yellowish

FOR OLIVE UNDERTONES (common in South Asians):
  - BRIGHTENING picks: warm pink, peach, coral, bright white, light turquoise, soft rose
  - These counteract the green cast and add warmth/glow to the face
  - AVOID: olive green, khaki, army green, grey-green — amplifies the olive making skin look muddy/dull

### Step 3 — Factor skin DEPTH for brightness:
- DEEP skin (dark brown to deep dark): High-saturation bright colours create stunning contrast and glow. Bright white, royal blue, fuchsia, emerald, hot pink, cobalt, orange-red ALL make deep skin RADIANT. Avoid muted/washed pastels that look ashy.
- MEDIUM skin (wheatish to medium brown): This is where brightness matters most. Soft pastels (pink, peach, sky blue, lavender) and bright whites create the maximum brightening/fairness effect. Avoid beige, nude, dull earth tones that blend with skin and make it appear darker.
- LIGHT Indian skin (fair to very fair): Can wear pastels well. Soft muted tones work but add some saturation. Baby pink, powder blue, soft peach give a fresh glow. Avoid washing out with pure white alone — pair with a colour.

### Step 4 — Contrast principle:
- HIGH contrast (dark hair + lighter skin): bold colours + white works beautifully for brightness
- LOW contrast (hair and skin similar depth): lighter tones near the face lift the overall appearance
- The best_colors MUST make this person's face appear brighter and more luminous when worn.

Return ONLY a valid JSON object. No markdown, no backticks, no extra text.

{
  "gender": "male | female | non-binary",
  "estimated_age_range": "e.g. 25-30",

  "face_shape": "one of: oval | round | square | heart | oblong | diamond | rectangle | triangle",
  "eye_color": "<descriptive color from the photo e.g. dark brown, hazel, black>",
  "hair_color": "<descriptive color from the photo e.g. jet black, dark brown>",
  "hair_texture": "one of: straight | wavy | curly | coily | thick | thin | fine",
  "hair_length": "one of: bald | buzz | short | medium | long | very long",
  "facial_hair": "<clean-shaven | stubble | goatee | full beard | mustache | null>",

  "body_type": "one of: ectomorph | mesomorph | endomorph | athletic | pear | apple | hourglass | rectangle | inverted-triangle",
  "build": "one of: slim | lean | average | muscular | stocky | heavy",
  "estimated_height_category": "one of: short (below 5'5) | average (5'5-5'9) | tall (5'10+)",
  "shoulder_width": "one of: narrow | average | broad",

  "skin_tone": "one of: very fair | fair | wheatish | light brown | medium brown | dark brown | deep dark",
  "skin_undertone": "one of: warm | cool | neutral | olive",
  "contrast_level": "one of: low contrast | medium contrast | high contrast — based on difference between hair/eye color and skin tone",
  "skin_tone_hex": "<exact hex code sampled from this person's actual skin colour in the photo, e.g. #C68642>",

  "colour_analysis": {
    "colour_season": "one of: Spring (warm, light, clear) | Summer (cool, muted, soft) | Autumn (warm, deep, muted) | Winter (cool, vivid, deep)",
    "season_subtype": "<e.g. Deep Autumn, Bright Winter, Soft Summer, Light Spring>",
    "season_description": "<2-3 sentences explaining WHY this season and subtype — reference this person's specific skin undertone, hair darkness, eye colour, and contrast from the photo>",

    "best_colors": [
      {"name": "<the single most flattering colour — precise shade name e.g. Peacock Blue, Burnt Sienna, Wine>", "hex": "<accurate hex — must look correct when rendered>", "why": "<explain using colour theory: what about their undertone/depth/contrast makes this colour work>"},
      {"name": "<2nd best>", "hex": "<hex>", "why": "<colour science reason>"},
      {"name": "<3rd best>", "hex": "<hex>", "why": "<colour science reason>"},
      {"name": "<4th best>", "hex": "<hex>", "why": "<colour science reason>"}
    ],

    "neutral_colors": [
      {"name": "<best neutral — e.g. Charcoal, Ivory, Warm Taupe, Stone, Off-White, Slate>", "hex": "<hex>", "why": "<why this neutral doesn't wash out or clash with their skin>"},
      {"name": "<2nd neutral>", "hex": "<hex>", "why": "<reason>"},
      {"name": "<3rd neutral>", "hex": "<hex>", "why": "<reason>"},
      {"name": "<4th neutral>", "hex": "<hex>", "why": "<reason>"}
    ],

    "worst_colors": [
      {"name": "<worst colour — name the exact shade>", "hex": "<hex>", "why": "<precise reason: e.g. too close to skin Munsell value so it blends, or the undertone clash creates sallow/ashy cast>"},
      {"name": "<2nd worst>", "hex": "<hex>", "why": "<reason>"},
      {"name": "<3rd worst>", "hex": "<hex>", "why": "<reason>"},
      {"name": "<4th worst>", "hex": "<hex>", "why": "<reason>"}
    ],

    "best_fabric_tones": "one of: muted earth tones | bright jewel tones | soft pastels | deep rich tones | warm neutrals | cool neutrals",
    "metal_tone": "one of: gold | silver | rose gold | copper | mixed metals — based on undertone"
  },

  "recommended_fits": ["array of 4-5 fit types that suit THIS person's body type e.g. slim-fit, relaxed, structured, tailored"],
  "necklines_that_suit": ["array of 3-4 necklines based on THIS person's face shape and shoulder width"],
  "patterns_that_suit": ["array of 4-5 patterns based on THIS person's build and contrast level"],
  "patterns_to_avoid": ["array of 3-4 patterns that would NOT flatter THIS person's proportions"],

  "style_personality": "one of: classic | trendy | casual | formal | streetwear | ethnic-fusion | minimalist | smart-casual"
}

CRITICAL RULES:
1. LOOK AT THE PHOTO. Every analysis must reference what you actually SEE — actual skin colour, actual hair, actual body. Do NOT give generic Indian advice. If the person has warm wheatish skin with jet black hair, the recommendations must reflect THAT specific combination.
2. Every hex code MUST be visually accurate — these are rendered as colour swatches next to the person's photo. Wrong hex = failed analysis. Double-check each hex against a mental colour wheel.
3. skin_tone_hex must be sampled from the person's ACTUAL face/neck area avoiding shadow zones.
4. best_colors: exactly 4. Prioritise colours that make this person's face look BRIGHTER, more radiant, and fairer. These must create luminous contrast — not too close in value to skin, not dull/muddy. Use Indian-context shade names.
5. neutral_colors: exactly 4. Must not wash out or blend with skin. Prefer lighter neutrals that maintain brightness (off-white, ivory, light grey) over dark neutrals unless the person has very fair skin.
6. worst_colors: exactly 4. Specifically identify colours that make THIS person's skin look DARKER, duller, or sallow. Explain the optical problem — "absorbs light making face appear darker" or "too close to skin value so complexion looks muddy".
7. Fits, necklines, and patterns must reference THIS person's actual body from the photo.
8. This person lives in India — consider Indian climate (hot + humid), regional fashion sensibilities, available fabrics (cotton, linen, khadi preferred for daily wear).
9. Do NOT include style_recommendations, stylist_notes, or fashion_notes arrays.""".strip()


def _build_avatar_gen_config(spec) -> dict:
    """Build the generationConfig payload from the avatar ModelSpec.

    NOTE: The Vertex AI REST API does NOT support `imageConfig` (aspectRatio,
    imageSize, outputMimeType) — those fields only exist in the google.genai SDK.
    Image output format is always PNG when responseModalities includes IMAGE.
    """
    gen_config: dict = {
        "temperature": spec.default_temperature,
        "maxOutputTokens": spec.default_max_tokens,
        "responseModalities": list(spec.response_modalities),
    }

    if spec.default_top_p is not None:
        gen_config["topP"] = spec.default_top_p

    if spec.supports_thinking and settings.GEMINI_AVATAR_THINKING_ENABLED:
        gen_config["thinkingConfig"] = {
            "thinkingLevel": settings.GEMINI_AVATAR_THINKING_LEVEL,
        }

    return gen_config


async def generate_avatar(image_bytes: bytes, mime_type: str) -> bytes:
    """Generate studio avatar using the configured avatar model via Vertex AI.

    Transforms the user's photo into a clean studio avatar with:
    - White background (#FFFFFF)
    - Neutral standing pose
    - Preserved facial identity
    - Proper framing (head to shoes)

    Uses the shared connection pool and AI semaphore for scalability.

    Args:
        image_bytes: Raw bytes of the user's photo.
        mime_type: MIME type of the input image.

    Returns:
        PNG bytes of the generated avatar image.

    Raises:
        Exception on rate limiting or if no image is returned.
    """
    spec = get_model(ModelPurpose.AVATAR)
    b64_input = base64.b64encode(image_bytes).decode("utf-8")

    contents = [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64_input}},
                {"text": AVATAR_BG_REMOVAL_PROMPT},
            ],
        }
    ]

    gen_config = _build_avatar_gen_config(spec)
    body = {"contents": contents, "generationConfig": gen_config}
    url = _vertex_url(spec.model_id, location=spec.vertex_location)
    headers = {"Authorization": f"Bearer {_get_token()}"}

    print(f"[Avatar] Using model={spec.model_id}  location={spec.vertex_location}  "
          f"thinking={'ON' if gen_config.get('thinkingConfig') else 'OFF'}")

    async with _ai_semaphore:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers=headers, timeout=120.0)

    if resp.status_code == 429:
        raise Exception("Rate limited — please try again in a moment")
    resp.raise_for_status()

    data = resp.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])

    for part in parts:
        if "inlineData" in part:
            img_data = part["inlineData"]["data"]
            return base64.b64decode(img_data)

    raise Exception("No image returned from avatar generation model")


async def analyse_body(image_bytes: bytes, mime_type: str) -> dict:
    """Analyse body proportions, skin tone, and colour profile using Vertex AI.

    Performs deep analysis of:
    - Face shape, eye color, hair properties
    - Body type, build, proportions
    - Skin tone with Fitzpatrick typing and undertone detection
    - Colour season analysis (best/neutral/worst colors)
    - Fit, neckline, and pattern recommendations

    Falls back to flash model if the pro model returns unparseable JSON.

    Args:
        image_bytes: Raw bytes of the user's full-body photo.
        mime_type: MIME type of the input image.

    Returns:
        Dict with comprehensive body and colour analysis data.

    Raises:
        Exception if both pro and flash models fail.
    """
    spec = get_model(ModelPurpose.BODY_ANALYSIS)
    b64_input = base64.b64encode(image_bytes).decode("utf-8")

    contents = [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64_input}},
                {"text": BODY_ANALYSIS_PROMPT},
            ],
        }
    ]

    url = _vertex_url(spec.model_id, location=spec.vertex_location)
    gen_config = {
        "temperature": spec.default_temperature,
        "maxOutputTokens": spec.default_max_tokens,
    }
    body = {"contents": contents, "generationConfig": gen_config}
    headers = {"Authorization": f"Bearer {_get_token()}"}

    print(f"[BodyAnalysis] model={spec.model_id} location={spec.vertex_location}")

    async with _ai_semaphore:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers=headers, timeout=180.0)

    if resp.status_code != 200:
        print(f"[BodyAnalysis] HTTP {resp.status_code}: {resp.text[:500]}")
        resp.raise_for_status()

    resp_json = resp.json()
    candidates = resp_json.get("candidates", [])
    if not candidates:
        print(f"[BodyAnalysis] No candidates. Response keys: {list(resp_json.keys())}")
        raise Exception("No candidates returned from body analysis model")

    parts = candidates[0].get("content", {}).get("parts", [])
    print(f"[BodyAnalysis] Got {len(parts)} parts: {[{k: type(v).__name__ for k, v in p.items()} for p in parts]}")

    text = ""
    for part in parts:
        if "text" in part and not part.get("thought"):
            text = part["text"].strip()
    if not text:
        for part in reversed(parts):
            if "text" in part:
                text = part["text"].strip()
                break

    if not text:
        raise Exception("No text returned from body analysis model")

    print(f"[BodyAnalysis] Raw text length={len(text)}, first 200 chars: {text[:200]}")

    try:
        return _repair_json(text)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[BodyAnalysis] Pro model JSON parse failed: {e}. Retrying with flash model...")
        fallback_model = get_model(ModelPurpose.VISION)
        fallback_url = _vertex_url(fallback_model.model_id, location=fallback_model.vertex_location)
        fallback_config = {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
        }
        fallback_body = {"contents": contents, "generationConfig": fallback_config}

        async with _ai_semaphore:
            client = _get_http_client()
            fallback_resp = await client.post(fallback_url, json=fallback_body, headers=headers, timeout=120.0)

        fallback_resp.raise_for_status()
        fallback_parts = fallback_resp.json()["candidates"][0]["content"]["parts"]
        fallback_text = ""
        for part in fallback_parts:
            if "text" in part and not part.get("thought"):
                fallback_text = part["text"].strip()
        if not fallback_text:
            for part in reversed(fallback_parts):
                if "text" in part:
                    fallback_text = part["text"].strip()
                    break
        print(f"[BodyAnalysis] Flash fallback text length={len(fallback_text)}")
        return _repair_json(fallback_text)
