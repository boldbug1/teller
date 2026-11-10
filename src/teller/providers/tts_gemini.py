from __future__ import annotations

import asyncio
import base64

from teller.models import Voice

_VOICE_TRAITS = {
    "Zephyr": "bright",
    "Puck": "upbeat",
    "Charon": "informative narrator",
    "Kore": "firm",
    "Fenrir": "excitable",
    "Leda": "youthful",
    "Orus": "firm",
    "Aoede": "breezy",
    "Callirrhoe": "easy-going",
    "Autonoe": "bright",
    "Enceladus": "breathy",
    "Iapetus": "clear narrator",
    "Umbriel": "easy-going",
    "Algieba": "smooth",
    "Despina": "smooth",
    "Erinome": "clear",
    "Algenib": "gravelly",
    "Rasalgethi": "informative",
    "Laomedeia": "upbeat",
    "Achernar": "soft",
    "Alnilam": "firm",
    "Schedar": "even narrator",
    "Gacrux": "mature",
    "Pulcherrima": "forward",
    "Achird": "friendly",
    "Zubenelgenubi": "casual",
    "Vindemiatrix": "gentle",
    "Sadachbia": "lively",
    "Sadaltager": "knowledgeable narrator",
    "Sulafat": "warm storyteller",
}


class GeminiTTS:
    provider_id = "gemini"
    language = None

    def __init__(self, api_key: str, model: str = "gemini-3.8-flash-lite-tts"):
        try:
            from google import genai
        except ImportError as error:  # pragma: no cover - optional dependency
            raise RuntimeError(
                'Install Gemini support with: pip install "teller-story[cloud]"'
            ) from error
        self.model_id = model
        self._client = genai.Client(api_key=api_key)

    async def list_voices(self) -> list[Voice]:
        return [
            Voice(id=name, name=name, traits=description.split())
            for name, description in _VOICE_TRAITS.items()
        ]

    def _synthesize(self, text: str, voice_id: str, style: str | None) -> bytes:
        content: dict[str, object] = {"type": "text", "text": text}
        if style:
            content["annotations"] = [{"type": "speech_metadata", "style": style}]
        interaction = self._client.interactions.create(
            model=self.model_id,
            input=[
                {
                    "type": "user_input",
                    "content": [content],
                }
            ],
            response_format={"type": "audio", "mime_type": "audio/wav"},
            generation_config={"speech_config": [{"voice": voice_id}]},
        )
        output = getattr(interaction, "output_audio", None)
        if output is None or not output.data:
            raise RuntimeError("Gemini returned no audio")
        return base64.b64decode(output.data)

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        # Gemini controls pace through style rather than a numeric speed field.
        speed_style = None if speed == 1.0 else f"speaking at {speed:.2f}x normal pace"
        combined_style = ", ".join(value for value in (style, speed_style) if value) or None
        return await asyncio.to_thread(self._synthesize, text, voice_id, combined_style)
