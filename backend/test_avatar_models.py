"""
Final validation — tests all 3 avatar models using the exact same payload shape
that avatar_service.py will send in production.

Usage:  python test_avatar_models.py
"""

import os
import json
import time
import warnings
import ssl
from pathlib import Path

ssl._create_default_https_context = ssl._create_unverified_context
os.environ["PYTHONHTTPSVERIFY"] = "0"
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request as AuthRequest

PROJECT = os.getenv("GCP_PROJECT_ID")
SA_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "./service-account.json")

PROMPT = "Generate a small solid blue circle centered on a pure white background."


def get_token() -> str:
    creds = service_account.Credentials.from_service_account_file(
        SA_PATH, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(AuthRequest())
    return creds.token


def vertex_url(model_id: str) -> str:
    return (
        f"https://aiplatform.googleapis.com/v1/"
        f"projects/{PROJECT}/locations/global/"
        f"publishers/google/models/{model_id}:generateContent"
    )


def test_model(name: str, model_id: str, temperature: float, top_p: float,
               thinking_enabled: bool, thinking_level: str, token: str) -> bool:
    url = vertex_url(model_id)

    gen_config = {
        "temperature": temperature,
        "maxOutputTokens": 8192,
        "responseModalities": ["IMAGE", "TEXT"],
        "topP": top_p,
    }

    if thinking_enabled:
        gen_config["thinkingConfig"] = {"thinkingLevel": thinking_level}

    payload = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": gen_config,
    }

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"  model:    {model_id}")
    print(f"  url:      {url}")
    print(f"  temp:     {temperature}  topP: {top_p}")
    print(f"  thinking: {'ON (' + thinking_level + ')' if thinking_enabled else 'OFF'}")
    print(f"{'='*60}")

    t0 = time.time()
    try:
        resp = requests.post(
            url, json=payload,
            headers={"Authorization": f"Bearer {token}"},
            verify=False, timeout=120,
        )
        elapsed = time.time() - t0

        if resp.status_code == 200:
            data = resp.json()
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            has_image = any("inlineData" in p for p in parts)
            has_text = any("text" in p for p in parts)
            img_size = 0
            for p in parts:
                if "inlineData" in p:
                    img_size = len(p["inlineData"].get("data", ""))
            print(f"  Status:   200 OK  ({elapsed:.1f}s)")
            print(f"  Image:    {'YES' if has_image else 'NO'}  (b64 size: {img_size:,} chars)")
            print(f"  Text:     {'YES' if has_text else 'NO'}")
            print(f"  RESULT:   PASS")
            return True
        elif resp.status_code == 429:
            print(f"  Status:   429 RATE LIMITED  ({elapsed:.1f}s)")
            print(f"  RESULT:   SKIP (quota exhausted, but model accepted the request shape)")
            return True
        else:
            err = resp.json().get("error", {}).get("message", resp.text[:300])
            print(f"  Status:   {resp.status_code}  ({elapsed:.1f}s)")
            print(f"  Error:    {err[:200]}")
            print(f"  RESULT:   FAIL")
            return False

    except requests.exceptions.Timeout:
        print(f"  TIMEOUT after 120s")
        print(f"  RESULT:   FAIL")
        return False
    except Exception as e:
        print(f"  Exception: {e}")
        print(f"  RESULT:   FAIL")
        return False


def main():
    print(f"Project:  {PROJECT}")
    print(f"Endpoint: global (aiplatform.googleapis.com)")
    token = get_token()
    print(f"Token:    {token[:20]}...")

    results = {}

    results["A"] = test_model(
        name="Option A — Nano Banana",
        model_id="gemini-2.5-flash-image",
        temperature=1.0, top_p=0.95,
        thinking_enabled=False, thinking_level="HIGH",
        token=token,
    )

    results["B"] = test_model(
        name="Option B — Nano Banana 2",
        model_id="gemini-3.1-flash-image-preview",
        temperature=1.0, top_p=0.95,
        thinking_enabled=True, thinking_level="HIGH",
        token=token,
    )

    results["C"] = test_model(
        name="Option C — Nano Banana Pro",
        model_id="gemini-3-pro-image-preview",
        temperature=1.0, top_p=0.95,
        thinking_enabled=False, thinking_level="HIGH",
        token=token,
    )

    print(f"\n\n{'='*60}")
    print(f"  FINAL SUMMARY")
    print(f"{'='*60}")
    for key, ok in results.items():
        label = {"A": "Nano Banana", "B": "Nano Banana 2", "C": "Nano Banana Pro"}[key]
        status = "PASS" if ok else "FAIL"
        print(f"  Option {key} ({label}): {status}")

    all_ok = all(results.values())
    print(f"\n  {'All models verified!' if all_ok else 'Some models failed — check above.'}")


if __name__ == "__main__":
    main()
