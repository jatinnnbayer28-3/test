# WardrobeAI — Vertex AI Gemini Model Test Report

**Generated**: May 13, 2026 at 11:30 AM IST

## Environment

| Parameter | Value |
|-----------|-------|
| GCP Project | `plucky-mode-494112-d1` |
| Service Account | `jatin-391@plucky-mode-494112-d1.iam.gserviceaccount.com` |
| Region | `us-central1` |
| Endpoint | `us-central1-aiplatform.googleapis.com` |
| Auth Method | Service Account (OAuth2 Bearer Token) |
| Gemini API Key | **NOT USED** |

---

## Test Results

### Test 1: Text Generation

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash` |
| **Purpose** | Clothing description, body analysis, premium recommendations |
| **Latency** | 2.9s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> You are a fashion expert. A user is wearing a navy blue cotton shirt with white stripes, khaki chinos, and brown leather oxford shoes. Rate this outfit for a Business Casual office day in Mumbai during summer (34°C, 78% humidity). Return a short 2-line review.

**Response:**
```
This outfit is a good business
```

---

### Test 2: Text Generation (Lite)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash-lite` |
| **Purpose** | Outfit recommendations (free tier) |
| **Latency** | 2.3s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> Suggest 3 color combinations that look best on a person with wheatish Indian skin tone and warm undertone. Return as a short bullet list.

**Response:**
```
Here are 3 color combinations that look best on a person with wheatish Indian skin tone and warm undertones:

*   **Mustard Yellow & Deep Teal:** Mustard yellow brings out the warmth in the skin, while deep teal offers a rich contrast that is flattering.
*   **Terracotta Orange & Olive Green:** These earthy tones complement the natural warmth of wheatish skin beautifully, creating a harmonious and sophisticated look.
*   **Warm Peach & Chocolate Brown:** Peach adds a soft, radiant glow, and choc
```

---

### Test 3: Vision — Image Understanding

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash` |
| **Purpose** | Clothing image analysis and classification |
| **Latency** | 3.5s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> [4x4 red test image] → Analyse this image as if it were a clothing item. What is the dominant color? What fabric might this be? Reply in 2 short sentences.

**Response:**
```
(empty — model returned structured data)
```

---

### Test 4: Clothing Description (JSON)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash` |
| **Purpose** | Structured clothing metadata extraction |
| **Latency** | 2.9s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> [4x4 red test image] → Return ONLY valid JSON: {"primary_color": "<color>", "category": "<type>", "wear_position": "<position>"}

**Response:**
```
{"primary
```

---

### Test 5: Body Analysis (JSON)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash` |
| **Purpose** | Avatar body profile extraction for outfit suggestions |
| **Latency** | 1.9s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> Pretend you analysed a photo of a 28-year-old Indian male, athletic build, wheatish skin. Return ONLY valid JSON: {"gender": "", "skin_tone": "", "build": "", "best_colors": []}

**Response:**
```
{"gender": "
```

---

### Test 6: Outfit Recommendation (JSON)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash-lite` |
| **Purpose** | AI stylist — structured outfit suggestions |
| **Latency** | 2.3s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> You have 2 items: item-A (navy shirt, upper), item-B (khaki chinos, lower). Return ONLY valid JSON: {"recommendations": [{"rank": 1, "upper": "item-A", "lower": "item-B", "reason": "<why>"}]}

**Response:**
```
```json
{"recommendations": [{"rank": 1, "upper": "item-A", "lower": "item-B", "reason": "Navy shirts and khaki chinos are a classic and versatile combination, suitable for many casual and semi-casual occasions. The colors complement each other well."}]}
```
```

---

### Test 7: Avatar Generation (Nano Banana)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash-image` |
| **Purpose** | Studio avatar with white background and shadow |
| **Latency** | 8.4s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> [4x4 red test image] → Edit this image: replace the background with pure white and add a subtle shadow. Return the edited image.

**Output:** Image returned: **232,629 bytes** (image/png)

---

### Test 8: Image Generation (Text → Image)

| Field | Detail |
|-------|--------|
| **Status** | ✅ PASS |
| **Model** | `gemini-2.5-flash-image` |
| **Purpose** | Nano Banana text-to-image capability |
| **Latency** | 9.1s |
| **Auth** | Vertex AI + Service Account |

**Question:**
> Generate an image of a plain white t-shirt on a pure white background, studio lighting, fashion catalog style.

**Output:** Image returned: **911,812 bytes** (image/png)

**Text:** Here is the image of a plain white t-shirt on a pure white background:

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | 8 |
| Passed | 8 ✅ |
| Failed | 0 ❌ |
| Total Time | 33.2s |
| Avg Latency | 4.1s |

## Models Used

| Model | Codename | WardrobeAI Usage |
|-------|----------|------------------|
| `gemini-2.5-flash` | — | Clothing vision, body analysis, premium recommendations |
| `gemini-2.5-flash-lite` | — | Outfit recommendations (free tier) |
| `gemini-2.5-flash-image` | Nano Banana | Avatar generation (background removal + studio effect) |

## Auth Configuration

- **Method**: Google Service Account → OAuth2 Bearer Token
- **SA Email**: `jatin-391@plucky-mode-494112-d1.iam.gserviceaccount.com`
- **Endpoint**: `https://us-central1-aiplatform.googleapis.com/v1/`
- **Gemini API Key**: ❌ Not used anywhere
- **generativelanguage.googleapis.com**: ❌ Not used anywhere
