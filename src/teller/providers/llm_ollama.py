from __future__ import annotations

import asyncio
from typing import Any, cast


class OllamaLLM:
    provider_id = "ollama"

    def __init__(
        self,
        model: str = "qwen3:8b",
        base_url: str = "http://localhost:11434",
    ):
        try:
            from ollama import Client
        except ImportError as error:  # pragma: no cover - optional dependency
            raise RuntimeError(
                'Install local support with: pip install "teller-story[local]"'
            ) from error
        self.model_id = model
        self._client = Client(host=base_url)

    def _generate(self, prompt: str, schema: dict[str, Any] | None) -> str:
        response = self._client.chat(
            model=self.model_id,
            messages=[{"role": "user", "content": prompt}],
            format=schema or "json",
            options={"temperature": 0},
            stream=False,
        )
        content = response.message.content
        if not content:
            raise RuntimeError("Ollama returned no text")
        return cast(str, content)

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        return await asyncio.to_thread(self._generate, prompt, schema)
