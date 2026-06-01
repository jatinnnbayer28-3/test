"""
Gemini/Vertex AI integration service for clothing analysis and outfit recommendations.

This module handles all communication with Google Vertex AI Gemini models:
- Clothing image description (category, color, pattern, fabric, etc.)
- Ghost mannequin product image generation
- Outfit recommendation generation with colour science
- Outfit photo analysis and shopping suggestions

Architecture:
- Uses httpx.AsyncClient with connection pooling (max 20 concurrent connections)
- Global asyncio.Semaphore limits concurrent AI jobs to prevent quota exhaustion
- Thread-safe GCP credential management with automatic refresh
- Robust JSON repair for LLM output parsing

Scaling (100 users):
- Connection pool shared across all requests (20 max connections to Vertex AI)
- Per-user concurrency controlled by semaphore (MAX_CONCURRENT_AI_JOBS=20 global)
- 429 responses trigger exponential backoff in the parallel_processor layer
"""

import json
import re
import base64
import asyncio
import threading
import warnings
import httpx
from google.oauth2 import service_account
from google.auth.transport.requests import Request as AuthRequest
from core.config import settings
from core.model_config import get_model, get_model_id, ModelPurpose

warnings.filterwarnings("ignore")

# Global connection pool for Vertex AI requests (shared across all users)
MAX_CONCURRENT_AI_JOBS = 20
_http_client: httpx.AsyncClient | None = None
_ai_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AI_JOBS)


def _get_http_client() -> httpx.AsyncClient:
    """Get or create the shared async HTTP client with connection pooling.

    The client maintains a pool of up to 20 concurrent connections to
    Vertex AI endpoints, reducing TCP handshake overhead and enabling
    HTTP/2 multiplexing.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=10.0),
            limits=httpx.Limits(
                max_connections=MAX_CONCURRENT_AI_JOBS,
                max_keepalive_connections=10,
                keepalive_expiry=30,
            ),
            verify=False,
        )
    return _http_client


async def close_http_client():
    """Close the shared HTTP client on shutdown. Called from lifespan."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


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

VERTEX_LOCATION = settings.GCP_LOCATION or "global"

_credentials = None
_token_lock = threading.Lock()


def _get_token() -> str:
    """Get a valid GCP access token, refreshing if expired.

    Thread-safe via _token_lock. Credentials are loaded from the service
    account JSON file specified in GOOGLE_APPLICATION_CREDENTIALS.
    """
    global _credentials
    with _token_lock:
        if _credentials is None:
            _credentials = service_account.Credentials.from_service_account_file(
                settings.GOOGLE_APPLICATION_CREDENTIALS,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
        if not _credentials.valid or _credentials.expired:
            _credentials.refresh(AuthRequest())
        return _credentials.token


def _vertex_url(model: str, location: str | None = None) -> str:
    """Build the Vertex AI generateContent endpoint URL for a given model and location."""
    loc = location or VERTEX_LOCATION
    if loc == "global":
        return (
            f"https://aiplatform.googleapis.com/v1/"
            f"projects/{settings.GCP_PROJECT_ID}/locations/global/"
            f"publishers/google/models/{model}:generateContent"
        )
    return (
        f"https://{loc}-aiplatform.googleapis.com/v1/"
        f"projects/{settings.GCP_PROJECT_ID}/locations/{loc}/"
        f"publishers/google/models/{model}:generateContent"
    )


async def _call_vertex_async(
    model: str,
    contents: list,
    temperature: float = 0.2,
    max_tokens: int = 1024,
    response_modalities: list = None,
    thinking_budget: int = 0,
) -> dict:
    """Make an async HTTP call to Vertex AI, gated by the global semaphore.

    Args:
        model: The Gemini model ID.
        contents: The conversation contents array.
        temperature: Sampling temperature (0.0-2.0).
        max_tokens: Maximum output tokens.
        response_modalities: Optional list like ["IMAGE", "TEXT"].
        thinking_budget: Token budget for extended thinking (0 = disabled).

    Returns:
        The parsed JSON response from Vertex AI.

    Raises:
        Exception on 429 rate limit or other HTTP errors.
    """
    url = _vertex_url(model)
    gen_config = {
        "temperature": temperature,
        "maxOutputTokens": max_tokens,
        "thinkingConfig": {"thinkingBudget": thinking_budget},
    }
    if response_modalities:
        gen_config["responseModalities"] = response_modalities
        gen_config.pop("thinkingConfig", None)

    body = {
        "contents": contents,
        "generationConfig": gen_config,
    }
    headers = {"Authorization": f"Bearer {_get_token()}"}
    timeout = 180.0 if thinking_budget > 0 else 120.0

    async with _ai_semaphore:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers=headers, timeout=timeout)

    if resp.status_code == 429:
        raise Exception(f"429 Rate limited: {resp.json().get('error',{}).get('message','')[:200]}")
    resp.raise_for_status()
    return resp.json()


def _extract_text(response: dict) -> str:
    """Extract the final text output from a Vertex AI response, ignoring thinking parts."""
    parts = response["candidates"][0]["content"]["parts"]
    text = ""
    for part in parts:
        if "text" in part and not part.get("thought"):
            text = part["text"]
    if not text:
        for part in reversed(parts):
            if "text" in part:
                text = part["text"]
                break
    return text or ""


DESCRIBE_PROMPT = """
You are a professional fashion analyst and wardrobe cataloguer specialising in Indian fashion and clothing. Analyse this clothing image with extreme detail to make it highly searchable.
Return ONLY a valid JSON object. No markdown, no backticks, no extra text. Just the raw JSON.

{
  "category": "one of exactly: tshirt | shirt | jeans | shorts | shoes | jacket | dress | kurta | saree | other",
  "sub_category": "<specific garment type, e.g.: polo shirt, henley, bomber jacket, chino shorts, oxford shoes, block-print kurta, palazzo pants, etc.>",
  "confidence": <float 0.0 to 1.0>,
  "primary_color": "<specific shade name, e.g.: navy blue, charcoal grey, rust orange, olive green, burgundy, cream white>",
  "secondary_color": "<specific shade name or null>",
  "accent_color": "<any third color detail or null>",
  "pattern": "one of: solid | striped | horizontal-striped | vertical-striped | pinstriped | checked | plaid | gingham | polka-dot | floral | paisley | abstract | geometric | animal-print | camouflage | tie-dye | ombre | color-block | graphic | text-print | embroidered | quilted | ribbed | cable-knit | plain",
  "pattern_description": "<describe the pattern in detail if not solid, e.g.: thin white horizontal stripes on navy base, large tropical leaf print, subtle tonal checks>",
  "fit_type": "one of: slim | skinny | regular | relaxed | oversized | loose | tailored | boxy | flared | straight",
  "fabric": "one of: cotton | organic-cotton | denim | raw-denim | polyester | nylon | linen | wool | cashmere | leather | suede | silk | satin | chiffon | velvet | corduroy | fleece | jersey | twill | canvas | mesh | lace | khadi | rayon | lycra | blended | unknown",
  "fabric_texture": "<describe texture: smooth, textured, brushed, washed, distressed, crisp, soft-touch, matte, shiny, etc.>",
  "neckline": "one of: crew | v-neck | deep-v | scoop | polo | collar | button-down-collar | mandarin | hood | turtle | mock-neck | boat-neck | square | halter | off-shoulder | cowl | null",
  "sleeve_length": "one of: full | three-quarter | half | short | cap | sleeveless | rolled | bell | puff | null",
  "garment_length": "one of: cropped | waist | hip | mid-thigh | knee | below-knee | midi | ankle | full-length | null",
  "closure_type": "<buttons | zip | pullover | snap | tie | wrap | hook | elastic | drawstring | none | null>",
  "embellishments": ["<any of: pockets | patch-pockets | zip-pockets | buttons | rivets | embroidery | sequins | beadwork | lace-trim | fringe | studs | belt-loops | drawstring | pleats | ruffles | distressing | raw-hem | cuffed | pintucks | applique> or empty array"],
  "occasion_tags": ["array of applicable: casual | office | formal | semi-formal | party | gym | outdoor | travel | wedding | festive | date-night | brunch | college | lounge | beach | temple-visit"],
  "style_tags": ["up to 5 from: streetwear | classic | sporty | smart-casual | ethnic | indo-western | minimal | bohemian | workwear | preppy | grunge | retro | vintage | athleisure | resort | edgy | romantic | normcore | techwear"],
  "season": ["applicable from: summer | monsoon | winter | all-season | spring | autumn"],
  "dominant_tone": "one of: warm | cool | neutral | earth | pastel | vibrant | muted | dark | bright",
  "wear_position": "one of: upper | lower | footwear | accessory",
  "brand_style_cues": "<describe what brand/aesthetic it resembles, e.g.: Zara minimal, H&M casual, FabIndia ethnic, Nike sporty>",
  "layering_potential": "one of: base-layer | mid-layer | outer-layer | standalone | versatile",
  "search_tags": ["15-20 highly specific searchable keywords covering: color shades, garment type, fabric, pattern, style, occasion, fit, season, features — e.g.: navy-blue, slim-fit, cotton, crew-neck, solid, casual, summer, office-wear, breathable, short-sleeve, hip-length"],
  "search_description": "<2-3 detailed sentences describing this item as if writing a product listing. Include color, fabric feel, fit, design details, suitable occasions, styling suggestions. Make it keyword-rich for search.>",
  "short_description": "<one natural sentence describing the item for use in outfit context>"
}
""".strip()

RETRY_PROMPT = """
Your previous response was not valid JSON. Return ONLY a raw JSON object with no markdown formatting, no backticks, no explanation. Just the JSON object starting with { and ending with }.
""".strip()

# ── Ghost Mannequin Prompts (per wear_position) ────────────────────

_GHOST_PROMPT_UPPER = """You are a professional product photographer's AI assistant specializing in ghost mannequin / invisible mannequin compositing for e-commerce catalogs.

TASK: Transform this clothing photo into a professional ghost mannequin product image.

ANALYSIS & EXECUTION:
1. HANGER/BODY REMOVAL: Detect and completely remove any hanger, human hand, arm, body part, or visible mannequin. Fill the removed area with clean white background.
2. COLLAR/NECKLINE: If the collar or neckline interior is visible, fill it with natural fabric continuation that matches the garment's color, texture, and pattern — creating the illusion of a 3D hollow form as if the garment is standing on its own.
3. SHOULDER STRUCTURE: Reshape the shoulders to appear naturally structured — as if draped over an invisible mannequin with proper 3D volume. Shoulders should be symmetrical and correctly proportioned.
4. SLEEVE DRAPE: Correct sleeve positioning so they hang naturally with realistic gravity. Maintain the original sleeve style (rolled, cuffed, full-length, etc.).
5. FABRIC CONTINUITY: All inpainted zones must seamlessly continue the original fabric's color, pattern, texture, and weave. No visible seams or AI artifacts at boundaries.
6. BACKGROUND: Pure clean white (#FFFFFF) background.
7. SHADOW: Add a subtle, natural contact shadow beneath the garment for a grounded 3D appearance.
8. PRESERVE: Keep every original detail — buttons, stitching, labels, embroidery, prints, pockets — exactly as they are.

OUTPUT: A single professional product catalog image ready for e-commerce listing.""".strip()

_GHOST_PROMPT_LOWER = """You are a professional product photographer's AI assistant specializing in ghost mannequin / invisible mannequin compositing for e-commerce catalogs.

TASK: Transform this bottom-wear / lower garment photo into a professional ghost mannequin product image.

ANALYSIS & EXECUTION:
1. HANGER/CLIP REMOVAL: Detect and completely remove any hanger, clips, clothespins, mannequin legs, or human body. Fill removed areas with clean white background.
2. WAISTBAND STRUCTURE: Shape the waistband into a natural 3D form — as if the garment is standing upright on an invisible mannequin. The waist opening should show slight depth and volume.
3. WAIST INTERIOR: If the inside of the waistband is visible, fill with natural fabric continuation matching the garment's inner lining or fabric reverse.
4. LEG DRAPE: Correct leg positioning so they hang symmetrically with realistic gravity. Maintain the original leg style (straight, tapered, flared, skinny, etc.).
5. FLY/CLOSURE AREA: Ensure the zipper fly, button closure, or drawstring area appears neat and properly aligned.
6. FABRIC CONTINUITY: All inpainted zones must seamlessly continue the original fabric's color, pattern (denim wash, stripes, checks), texture, and weave.
7. BACKGROUND: Pure clean white (#FFFFFF) background.
8. SHADOW: Add a subtle, natural contact shadow beneath the garment for a grounded 3D appearance.
9. PRESERVE: Keep every original detail — rivets, belt loops, distressing, stitching, pockets, labels — exactly as they are.

OUTPUT: A single professional product catalog image ready for e-commerce listing.""".strip()

_GHOST_PROMPT_FOOTWEAR = """You are a professional product photographer's AI assistant specializing in footwear product photography for e-commerce catalogs.

TASK: Transform this footwear photo into a professional product catalog image.

ANALYSIS & EXECUTION:
1. HOLDER REMOVAL: Detect and completely remove any mannequin foot, shoe tree, human hand, foot, holder, or display stand. Fill removed areas cleanly.
2. LACE/STRAP ARRANGEMENT: Arrange laces, straps, buckles, and closures neatly — they should look tidy and intentionally styled as in a professional product shoot.
3. POSITIONING: The shoe should appear naturally positioned at a flattering angle (slight 3/4 view preferred) showing both the side profile and partial top-down view.
4. SOLE CLEANUP: Clean up the sole area — remove any dust, floor marks, or surface artifacts while preserving the actual sole design and tread pattern.
5. INTERIOR: If the shoe opening/interior is visible, ensure it looks clean and natural.
6. MATERIAL FIDELITY: Preserve exact material appearance — leather grain, suede nap, canvas weave, mesh texture, rubber finish.
7. BACKGROUND: Pure clean white (#FFFFFF) background.
8. SHADOW: Add a subtle, natural ground shadow beneath the shoe for a grounded 3D appearance.
9. PRESERVE: Keep every original detail — logos, stitching, eyelets, pull tabs, brand markings — exactly as they are.

OUTPUT: A single professional product catalog image ready for e-commerce listing.""".strip()

_GHOST_PROMPTS = {
    "upper": _GHOST_PROMPT_UPPER,
    "lower": _GHOST_PROMPT_LOWER,
    "footwear": _GHOST_PROMPT_FOOTWEAR,
}


async def generate_ghost_mannequin(
    image_bytes: bytes, mime_type: str, wear_position: str,
    model_purpose: ModelPurpose = ModelPurpose.GHOST_A,
) -> bytes:
    """Generate a ghost mannequin product image using Vertex AI image generation.

    Uses the shared httpx.AsyncClient with connection pooling and is gated
    by the global AI semaphore to prevent quota exhaustion under load.

    Args:
        image_bytes: Raw bytes of the clothing photo.
        mime_type: MIME type of the image (e.g., "image/jpeg").
        wear_position: One of "upper", "lower", "footwear".
        model_purpose: Which ghost model slot to use (A or B for load distribution).

    Returns:
        PNG image bytes of the cleaned-up product catalog image.

    Raises:
        Exception on 429 rate limit or if no image is returned.
    """
    prompt = _GHOST_PROMPTS.get(wear_position, _GHOST_PROMPT_UPPER)
    spec = get_model(model_purpose)

    b64_input = base64.b64encode(image_bytes).decode("utf-8")
    contents = [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64_input}},
                {"text": prompt},
            ],
        }
    ]

    gen_config = {
        "temperature": spec.default_temperature,
        "maxOutputTokens": spec.default_max_tokens,
        "responseModalities": ["IMAGE", "TEXT"],
    }
    if spec.default_top_p is not None:
        gen_config["topP"] = spec.default_top_p

    body = {"contents": contents, "generationConfig": gen_config}
    url = _vertex_url(spec.model_id, location=spec.vertex_location)
    headers = {"Authorization": f"Bearer {_get_token()}"}

    async with _ai_semaphore:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers=headers, timeout=120.0)

    if resp.status_code == 429:
        raise Exception("429 Rate limited — please retry in a moment")
    resp.raise_for_status()

    data = resp.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])

    for part in parts:
        if "inlineData" in part:
            return base64.b64decode(part["inlineData"]["data"])

    raise Exception("No image returned from ghost mannequin model")


async def describe_clothing(image_bytes: bytes, mime_type: str) -> dict:
    """Analyse a clothing image and return structured metadata.

    Uses the vision model to extract category, colors, patterns, fabric,
    fit, and searchable tags. Retries with lower temperature on JSON parse failure.

    Args:
        image_bytes: Raw bytes of the clothing photo.
        mime_type: MIME type (e.g., "image/jpeg").

    Returns:
        Dict with all clothing attributes (category, colors, pattern, etc.).

    Raises:
        json.JSONDecodeError if both attempts fail to produce valid JSON.
    """
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    contents = [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64}},
                {"text": DESCRIBE_PROMPT},
            ],
        }
    ]

    vision_model = get_model_id(ModelPurpose.VISION)

    resp = await _call_vertex_async(vision_model, contents, temperature=0.2, max_tokens=2048)
    text = _extract_text(resp).strip()

    try:
        return _repair_json(text)
    except (json.JSONDecodeError, ValueError):
        retry_contents = [
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": mime_type, "data": b64}},
                    {"text": RETRY_PROMPT},
                ],
            }
        ]
        retry_resp = await _call_vertex_async(vision_model, retry_contents, temperature=0.1, max_tokens=2048)
        return _repair_json(_extract_text(retry_resp).strip())


async def generate_outfit_recommendations(
    wardrobe_items: list,
    avatar_profile: dict,
    calendar_day: dict,
    weather: dict,
    recent_worn: list,
    preferences: dict,
    user_tier: str = "free",
    location: dict = None,
) -> tuple:
    model = get_model_id(
        ModelPurpose.RECOMMENDATION_PREMIUM
        if user_tier == "premium"
        else ModelPurpose.RECOMMENDATION_FREE
    )

    location = location or {}
    loc_city = location.get("city", "Unknown")
    loc_state = location.get("state", "Unknown")
    loc_district = location.get("district", "")

    avatar_section = "No avatar profile available — use general Indian fashion guidelines."
    if avatar_profile:
        avatar_section = f"""{json.dumps(avatar_profile, indent=2)}

USE THIS PROFILE ACTIVELY:
- Match clothing colors to the person's "best_colors" and use "neutral_colors" as safe base/bottom colors
- AVOID their "worst_colors" — these clash with their skin tone
- Pick fits from "recommended_fits" that suit their body_type and build
- Choose necklines from "necklines_that_suit" based on face_shape and shoulder_width
- Select patterns from "patterns_that_suit" and AVOID "patterns_to_avoid"
- Factor skin_tone + skin_undertone + contrast_level into colour harmony scoring
- Consider hair_color and eye_color when judging overall look harmony"""

    prompt = f"""
You are an elite personal stylist specialising in Indian fashion, colour science for Indian skin tones, regional climate, body-type dressing, and colour theory. You deeply understand Indian social occasions, regional dress norms, and how weather affects outfit comfort.
Return ONLY valid JSON. No markdown, no backticks, no extra text.

## WARDROBE (available items)
{json.dumps(wardrobe_items, indent=2)}

## USER BODY PROFILE (from avatar analysis)
{avatar_section}

## LOCATION
City: {loc_city}
District: {loc_district}
State: {loc_state}
Regional context: Consider local dress norms, cultural expectations, and regional fashion sensibilities for {loc_city}, {loc_state}. For example, Bangalore tech offices are more casual than Mumbai corporate offices; Delhi winters need layering; Chennai humidity demands breathable fabrics.

## TODAY'S OCCASION
Date: {calendar_day['date']}
Occasion: {calendar_day['occasion_tag']}
Dress Code: {calendar_day['dress_code']}
Time of Day: {calendar_day['time_of_day']}
Personal Note: {calendar_day.get('personal_note', 'None')}

## LIVE WEATHER at {loc_city}
Temperature: {weather.get('temp_min_c', 'N/A')}°C (low) → {weather.get('temp_max_c', 'N/A')}°C (high)
Feels Like: {weather.get('feels_like_min_c', 'N/A')}°C → {weather.get('feels_like_max_c', 'N/A')}°C
Humidity: {weather.get('humidity_pct', 'N/A')}%
Rain: {weather.get('rain_prob_pct', 'N/A')}% probability, {weather.get('rain_mm', 'N/A')}mm expected
Condition: {weather.get('weather_label', 'N/A')} {weather.get('weather_emoji', '')}
Wind: {weather.get('wind_kmh', 'N/A')} km/h
UV Index: {weather.get('uv_index', 'N/A')}
AI Hint: {weather.get('outfit_hint', 'N/A')}

WEATHER-BASED RULES by TIME OF DAY:
- Morning → use min temp, possible fog/dew, cooler start
- Afternoon → hottest, use max temp + UV for fabric/color decisions
- Evening → cooling down, may need something slightly warmer
- Night → near min temp, lighter/reflective colors for visibility
- Full Day → must work across entire temperature range

FABRIC DECISIONS:
- High humidity (>70%) + hot → avoid polyester/synthetic, prefer cotton/linen
- Rain expected → avoid light-colored fabrics that show water marks
- UV > 6 → prefer full-sleeve or darker fabrics for sun protection
- Cold (<15°C) → pick warmer upper wear (sweater, hoodie, jacket from upper category)

## COLOUR SCIENCE FOR INDIAN SKIN TONES
Apply these principles critically when scoring colour_harmony:
- Indian skin ranges from fair (Fitzpatrick III) to deep (Fitzpatrick VI). Most have warm/olive/neutral undertones.
- WARM undertones (golden/yellow): best with earthy tones (mustard, rust, olive, warm browns, coral, terracotta), warm reds, gold-toned neutrals. Avoid icy pastels, cool grays, neon pink.
- COOL undertones (pink/bluish): best with jewel tones (emerald, sapphire, ruby, amethyst), cool grays, navy, berry, plum. Avoid orange, warm yellow, camel.
- NEUTRAL undertones: versatile — teal, dusty rose, soft white, medium blues, sage green all work.
- DEEP skin tones: rich saturated colors pop beautifully (cobalt, fuchsia, emerald, bright white, true red). Avoid washed-out pastels that can look dull.
- MEDIUM skin tones: jewel tones, earth tones, and mid-range saturated colors work best. Avoid very pale yellows or beige that blend with skin.
- LIGHT Indian skin: can carry pastels better but still looks best in colors with some saturation (not washed out).
- CONTRAST LEVEL matters: high contrast (dark hair + lighter skin) → can wear bold color combinations and graphic prints. Low contrast → stick to tonal, analogous colour schemes.
- Upper + Lower colour pairing: ensure the combination creates visual balance. Dark bottom + light/bright top is universally flattering. Avoid matching exact same shade top-to-bottom unless intentional monochrome.
- Shoes should complement, not clash — brown leather with earth tones, white sneakers with casual, black with formal/cool palettes.

## RECENTLY WORN (do NOT repeat)
{json.dumps(recent_worn, indent=2)}

## USER PREFERENCES
Disliked patterns: {preferences.get('disliked_patterns', [])}
Preferred styles: {preferences.get('preferred_styles', [])}

## TASK
Generate the top 5 outfit combinations from the wardrobe.

STRICT RULES:
1. Each outfit: exactly 1 upper (wear_position: upper) + 1 lower (wear_position: lower) + 1 footwear (wear_position: footwear). NO extra/layer items. Treat every upper item (including jackets, hoodies, sweaters) as a single standalone upper wear.
2. Use ONLY item_ids present in the wardrobe above.
3. Do NOT repeat recently worn combinations.
4. Rate honestly — lower scores if wardrobe lacks ideal options.
5. Rank 1 = best match for occasion + weather + body profile + location + colour science.
6. In overall_reason, be specific: mention the actual colours of the clothes and how they interact with the person's skin tone/undertone, how the fabric works for the weather, and why the fit suits their body type.
7. Apply Indian colour science rules above rigorously when scoring colour_harmony.

Return this exact JSON:
{{
  "recommendations": [
    {{
      "rank": 1,
      "outfit_name": "<creative 3-word outfit name>",
      "upper": {{
        "item_id": "<exact item_id from wardrobe>",
        "reason_for_pick": "<why — reference body profile, skin tone, colour science, weather, occasion>"
      }},
      "lower": {{
        "item_id": "<exact item_id from wardrobe>",
        "reason_for_pick": "<why — reference body profile, colour pairing with upper, weather, occasion>"
      }},
      "shoes": {{
        "item_id": "<exact item_id from wardrobe>",
        "reason_for_pick": "<why — reference colour coordination, occasion, weather>"
      }},
      "rating": 8.5,
      "rating_breakdown": {{
        "colour_harmony": 8.0,
        "occasion_fit": 9.0,
        "style_coherence": 8.5
      }},
      "overall_reason": "<2-3 sentences: how this outfit's specific colours work with the person's skin tone and undertone, how fabric suits the weather, why the fit works for their body. Be concrete — name the actual colours.>"
    }}
  ]
}}
""".strip()

    contents = [{"role": "user", "parts": [{"text": prompt}]}]

    resp = await _call_vertex_async(model, contents, temperature=0.4, max_tokens=4096, thinking_budget=8192)
    text = _extract_text(resp).strip()
    parsed = _repair_json(text)
    recs = parsed.get("recommendations", parsed if isinstance(parsed, list) else [])

    valid_ids = {item["item_id"] for item in wardrobe_items}
    validated = []
    for rec in recs:
        ids_in_rec = [
            rec.get("upper", {}).get("item_id"),
            rec.get("lower", {}).get("item_id"),
            rec.get("shoes", {}).get("item_id"),
        ]
        if rec.get("extra") and rec["extra"].get("item_id"):
            ids_in_rec.append(rec["extra"]["item_id"])

        if all(rid in valid_ids for rid in ids_in_rec if rid):
            validated.append(rec)

    return validated, model


async def analyse_outfit_photo(
    image_bytes: bytes,
    mime_type: str,
    categories: list[str],
    wardrobe_items: list,
    avatar_profile: dict,
) -> dict:
    """Analyse a photo, rate the outfit, and suggest clothing grouped by category."""
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    wardrobe_summary = ""
    if wardrobe_items:
        by_pos = {}
        for item in wardrobe_items:
            pos = item.get("wear_position", "other")
            by_pos.setdefault(pos, []).append(
                f"- {item.get('short_description', item.get('category', '?'))} "
                f"({item.get('primary_color', '?')}, {item.get('fabric', '?')}, {item.get('pattern', 'solid')})"
            )
        for pos, descs in by_pos.items():
            wardrobe_summary += f"\n### {pos.upper()} ({len(descs)} items)\n" + "\n".join(descs)

    colour_info = ""
    if avatar_profile:
        ca = avatar_profile.get("colour_analysis", {})
        best = ca.get("best_colors", [])
        skin = avatar_profile.get("skin_tone", "")
        undertone = avatar_profile.get("skin_undertone", "")
        if skin:
            colour_info = f"Skin tone: {skin}, Undertone: {undertone}\nBest colours: {json.dumps(best)}"

    cat_json = json.dumps(categories)

    prompt = f"""You are an elite Indian outfit critic and fashion stylist. THINK DEEPLY before answering.

STEP 1 — RATE THE OUTFIT: Look at this photo. Analyse the person's face colour, skin tone, and the clothing they are wearing. Rate the outfit out of 10 like a fashion critic — consider colour harmony with skin, fit, style coherence, and overall look. Be honest and constructive.

STEP 2 — SUGGEST CLOTHING: For EACH requested category, suggest 5 generalised clothing items (colour, type, fabric) that would:
- Look great on this person based on their skin tone and face colour
- Complement their existing wardrobe collection
- Make their skin look brighter and more radiant

Requested categories: {cat_json}

## EXISTING WARDROBE (for context — avoid duplicates)
{wardrobe_summary if wardrobe_summary else "No wardrobe data available."}

## USER COLOUR PROFILE
{colour_info if colour_info else "Not available — use general Indian fashion guidelines."}

## RULES
1. Rate honestly — if the outfit doesn't suit their skin tone, say so
2. For EACH requested category, give exactly 5 suggestions (ranked best to worst)
3. Each suggestion must include: type, colour (name + hex), fabric
4. Colours must suit Indian skin tones — pick shades that brighten their face
5. Consider Indian climate (hot, humid) and available fabrics
6. Don't suggest items too similar to what they already own

Return ONLY valid JSON. No markdown, no backticks.
{{
  "detected_outfit": "<what you see them wearing — colours, type, style>",
  "rating": <integer 1-10>,
  "critique": "<2-3 sentences as a fashion critic — what works, what doesn't, how the colours interact with their skin tone>",
  "categories": {{
    "<category_name>": [
      {{
        "rank": 1,
        "type": "<specific item type e.g. Slim-fit Henley T-shirt>",
        "colour": {{"name": "<precise shade>", "hex": "<hex code>"}},
        "fabric": "<fabric e.g. cotton, linen, denim>",
        "reason": "<1-2 sentences: why this suits their skin tone and complements wardrobe>"
      }}
    ]
  }}
}}

The "categories" object must have a key for EACH requested category: {cat_json}. Each key maps to an array of exactly 5 suggestions.""".strip()

    vision_model = get_model_id(ModelPurpose.VISION)
    contents = [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64}},
                {"text": prompt},
            ],
        }
    ]

    resp = await _call_vertex_async(vision_model, contents, temperature=0.4, max_tokens=8192, thinking_budget=8192)
    parsed = _repair_json(_extract_text(resp).strip())

    return {
        "detected_outfit": parsed.get("detected_outfit", ""),
        "rating": parsed.get("rating", 0),
        "critique": parsed.get("critique", ""),
        "categories": parsed.get("categories", {}),
    }


async def generate_shopping_suggestions(
    wardrobe_items: list,
    avatar_profile: dict,
    categories: list[str],
) -> dict:
    """Suggest clothing to buy grouped by category, using deep thinking."""
    colour_info = ""
    if avatar_profile:
        ca = avatar_profile.get("colour_analysis", {})
        best = ca.get("best_colors", [])
        neutral = ca.get("neutral_colors", [])
        skin = avatar_profile.get("skin_tone", "")
        undertone = avatar_profile.get("skin_undertone", "")
        body_type = avatar_profile.get("body_type", "")
        build = avatar_profile.get("build", "")
        colour_info = f"""
Skin tone: {skin}, Undertone: {undertone}, Body type: {body_type}, Build: {build}
Best colours for this person: {json.dumps(best)}
Neutral colours that work: {json.dumps(neutral)}
"""

    wardrobe_summary = ""
    if wardrobe_items:
        by_pos = {}
        for item in wardrobe_items:
            pos = item.get("wear_position", "other")
            by_pos.setdefault(pos, []).append(
                f"- {item.get('short_description', item.get('category', '?'))} "
                f"({item.get('primary_color', '?')}, {item.get('fabric', '?')}, {item.get('pattern', 'solid')})"
            )
        for pos, descs in by_pos.items():
            wardrobe_summary += f"\n### {pos.upper()} ({len(descs)} items)\n" + "\n".join(descs)

    cat_json = json.dumps(categories)

    prompt = f"""You are an elite Indian fashion consultant. THINK DEEPLY before answering.
The user wants to buy new clothing. For EACH requested category, suggest 5 items that:
1. SUIT THEIR LOOKS — match their skin tone, body type, and what makes them look best
2. COMPLEMENT THEIR WARDROBE — pair well with existing items
3. BUILD A GOOD COLLECTION — fill colour/style gaps for versatility

Requested categories: {cat_json}

## USER PROFILE
{colour_info if colour_info else "Not available — use general Indian fashion guidelines for medium-toned skin."}

## CURRENT WARDROBE
{wardrobe_summary if wardrobe_summary else "No wardrobe data available."}

## RULES
1. For EACH requested category, give exactly 5 suggestions (ranked best to worst)
2. Each suggestion: type, colour (name + hex), fabric, occasion, description, reason
3. Colours must brighten Indian skin — no dull/muddy shades
4. Don't duplicate what they already own — add variety
5. Indian climate (hot, humid), fabrics (cotton, linen, denim, khadi)

Return ONLY valid JSON. No markdown, no backticks.
{{
  "wardrobe_analysis": "<2-3 sentences: what the wardrobe has, what's missing>",
  "categories": {{
    "<category_name>": [
      {{
        "rank": 1,
        "type": "<specific item type e.g. Slim-fit Oxford Shirt>",
        "colour": {{"name": "<shade name>", "hex": "<hex code>"}},
        "fabric": "<fabric e.g. cotton, linen>",
        "occasion": "<casual / office / formal / versatile>",
        "description": "<1-2 sentences — what to look for when shopping>",
        "reason": "<why this suits their looks AND fills a wardrobe gap>"
      }}
    ]
  }}
}}

The "categories" object must have a key for EACH requested category: {cat_json}. Each key maps to an array of exactly 5 suggestions.""".strip()

    model = get_model_id(ModelPurpose.RECOMMENDATION_FREE)
    contents = [{"role": "user", "parts": [{"text": prompt}]}]

    resp = await _call_vertex_async(model, contents, temperature=0.5, max_tokens=8192, thinking_budget=8192)
    parsed = _repair_json(_extract_text(resp).strip())

    return {
        "wardrobe_analysis": parsed.get("wardrobe_analysis", ""),
        "categories": parsed.get("categories", {}),
    }
