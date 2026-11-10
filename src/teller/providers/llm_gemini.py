from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any, cast


class GeminiLLM:
    provider_id = "gemini"

    def __init__(self, api_key: str, model: str = "gemini-3.8-flash"):
        if not api_key or not api_key.strip():
            raise RuntimeError("Gemini API key is required but was not provided.")
        self.api_key = api_key.strip()
        self.model_id = model

    def _generate(self, prompt: str, schema: dict[str, Any] | None) -> str:
        # Use direct Google AI REST endpoint with strict timeout and no multi-hour quota sleep
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_id}:generateContent"
            f"?key={self.api_key}"
        )
        body: dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
        }
        if schema:
            body["generationConfig"] = {
                "responseMimeType": "application/json",
                "responseSchema": schema,
            }

        payload_bytes = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "teller/1.0",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                msg = err_body

            if err.code == 429:
                raise RuntimeError(
                    f"Gemini API Quota Exceeded (HTTP 429): {msg}. "
                    "Your free-tier daily quota (20 requests/day) has been reached. "
                    "Please provide a new Gemini API key in Settings or upgrade your Gemini plan."
                ) from err
            elif err.code in (400, 401, 403):
                raise RuntimeError(
                    f"Gemini Authentication Error (HTTP {err.code}): {msg}. "
                    "Please check your API key in Settings."
                ) from err
            elif err.code == 404:
                raise RuntimeError(
                    f"Gemini Model Not Found (HTTP 404): {msg}. "
                    f"Model '{self.model_id}' is not available."
                ) from err
            else:
                raise RuntimeError(f"Gemini API error (HTTP {err.code}): {msg}") from err
        except TimeoutError as err:
            raise RuntimeError("Gemini API request timed out after 45 seconds.") from err
        except Exception as err:
            raise RuntimeError(f"Failed to connect to Gemini API: {err}") from err

        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError(f"Gemini returned no candidates: {data}")

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts or "text" not in parts[0]:
            raise RuntimeError(f"Gemini returned no text content: {data}")

        return cast(str, parts[0]["text"])

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        return await asyncio.to_thread(self._generate, prompt, schema)
