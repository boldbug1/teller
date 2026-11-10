from __future__ import annotations

import asyncio
from typing import Any, cast


class GeminiLLM:
    provider_id = "gemini"

    def __init__(self, api_key: str, model: str = "gemini-3.8-flash"):
        try:
            from google import genai
        except ImportError as error:  # pragma: no cover - optional dependency
            raise RuntimeError(
                'Install Gemini support with: pip install "teller-story[cloud]"'
            ) from error
        self.model_id = model
        self._client = genai.Client(api_key=api_key)

    def _generate(self, prompt: str, schema: dict[str, Any] | None) -> str:
        response_format: dict[str, Any] = {
            "type": "text",
            "mime_type": "application/json" if schema else "text/plain",
        }
        if schema:
            response_format["schema"] = schema
        interaction = self._client.interactions.create(
            model=self.model_id,
            input=prompt,
            response_format=response_format,
        )
        output = getattr(interaction, "output_text", None)
        if not output:
            raise RuntimeError("Gemini returned no text")
        return cast(str, output)

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        return await asyncio.to_thread(self._generate, prompt, schema)
