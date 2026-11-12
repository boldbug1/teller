from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any


class GroqLLM:
    provider_id = "groq"

    def __init__(
        self,
        api_key: str,
        model: str = "openai/gpt-oss-120b",
    ):
        if not api_key or not api_key.strip():
            raise RuntimeError("Groq API key is required but was not provided.")
        self.api_key = api_key.strip()
        self.model_id = model or "openai/gpt-oss-120b"

    def _generate(self, prompt: str, schema: dict[str, Any] | None) -> str:
        url = "https://api.groq.com/openai/v1/chat/completions"
        system_instruction = (
            "You are an expert literary dialogue tagger.\n"
            "You must return ONLY a single valid JSON object that strictly adheres to the requested schema.\n"
        )
        if schema:
            system_instruction += (
                f"Strict JSON Schema:\n{json.dumps(schema)}\n\n"
                "Ensure every unit is labeled in 'assignments' with 'unit_id' and 'speaker_ref'. "
                "List all characters in 'characters' with 'ref' and 'name'.\n"
            )
        system_instruction += (
            "Do not output markdown code fences, greetings, or conversational preamble."
        )

        candidate_models = [self.model_id]
        fallback_models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]
        for fm in fallback_models:
            if fm not in candidate_models:
                candidate_models.append(fm)

        last_err: Exception | None = None
        for model in candidate_models:
            body: dict[str, Any] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1,
            }

            payload_bytes = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
                },
            )

            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    choices = data.get("choices", [])
                    if choices:
                        content = choices[0].get("message", {}).get("content", "")
                        if content:
                            self.model_id = model
                            return content
            except urllib.error.HTTPError as err:
                err_body = err.read().decode("utf-8", errors="replace")
                try:
                    err_json = json.loads(err_body)
                    msg = err_json.get("error", {}).get("message", err_body)
                except Exception:
                    msg = err_body

                if err.code == 404:
                    last_err = RuntimeError(f"Groq Model {model} unavailable (HTTP 404): {msg}")
                    continue
                if err.code == 429:
                    raise RuntimeError(
                        f"Groq Rate Limit Exceeded (HTTP 429): {msg}."
                    ) from err
                if err.code in (401, 403):
                    raise RuntimeError(
                        f"Groq Authentication Failed (HTTP {err.code}): {msg}. "
                        "Please check your Groq API key in Settings."
                    ) from err
                raise RuntimeError(f"Groq API Error (HTTP {err.code}): {msg}") from err
            except urllib.error.URLError as err:
                raise RuntimeError(
                    f"Failed to connect to Groq API ({err.reason}). Please verify your internet connection."
                ) from err

        if last_err:
            raise last_err
        raise RuntimeError("Groq API returned an empty response.")

        return content

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        return await asyncio.to_thread(self._generate, prompt, schema)

