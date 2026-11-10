from __future__ import annotations

from typing import Any

import httpx

from teller.models import Voice


def _parse_error_detail(data: Any) -> str:
    if isinstance(data, dict):
        if "detail" in data:
            return _parse_error_detail(data["detail"])
        if "message" in data:
            return str(data["message"])
        return str(data)
    if isinstance(data, list):
        return "; ".join(_parse_error_detail(item) for item in data)
    return str(data) if data is not None else "Unknown error"


class ElevenLabsTTS:
    provider_id = "elevenlabs"

    def __init__(
        self,
        api_key: str,
        model: str = "eleven_multilingual_v2",
        *,
        language: str | None = None,
        base_url: str = "https://api.elevenlabs.io",
        client: httpx.AsyncClient | None = None,
    ):
        if not api_key:
            raise ValueError("ElevenLabs API key is required")
        self._api_key = api_key
        self.model_id = model
        self._language = language
        self.base_url = base_url.rstrip("/")
        self._client = client

    @property
    def language(self) -> str | None:
        return self._language

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=60.0)

    async def list_voices(self) -> list[Voice]:
        client = self._get_client()
        should_close = self._client is None
        voices: list[Voice] = []
        next_page_token: str | None = None
        headers = {"xi-api-key": self._api_key}

        try:
            while True:
                params: dict[str, str] = {
                    "page_size": "100",
                    "include_total_count": "false",
                }
                if next_page_token:
                    params["next_page_token"] = next_page_token

                response = await client.get(
                    f"{self.base_url}/v2/voices",
                    headers=headers,
                    params=params,
                )
                if not response.is_success:
                    request_id = response.headers.get("request-id") or response.headers.get(
                        "x-request-id"
                    )
                    try:
                        error_data = response.json()
                        detail = _parse_error_detail(error_data)
                    except Exception:
                        detail = response.text or "Unknown error"
                    req_info = f" (request_id={request_id})" if request_id else ""
                    msg = (
                        f"ElevenLabs voice listing failed ({response.status_code}): "
                        f"{detail}{req_info}"
                    )
                    raise RuntimeError(msg)

                data = response.json()
                raw_voices = data.get("voices") if isinstance(data, dict) else []
                if isinstance(raw_voices, list):
                    for item in raw_voices:
                        if not isinstance(item, dict):
                            continue
                        voice_id = item.get("voice_id")
                        if not voice_id or not isinstance(voice_id, str):
                            continue

                        name = item.get("name")
                        name_str = str(name).strip() if name else voice_id

                        labels = item.get("labels") or {}
                        if not isinstance(labels, dict):
                            labels = {}

                        gender = labels.get("gender") or item.get("gender")
                        gender_str = str(gender).strip() if gender else None

                        age = labels.get("age") or item.get("age")
                        age_str = str(age).strip() if age else None

                        traits: list[str] = []
                        if accent := labels.get("accent"):
                            traits.append(str(accent))
                        if use_case := labels.get("use_case") or labels.get("use case"):
                            traits.append(str(use_case))
                        if desc := labels.get("description"):
                            traits.append(str(desc))
                        if category := item.get("category"):
                            traits.append(str(category))

                        for k, v in labels.items():
                            if (
                                k.lower()
                                not in (
                                    "gender",
                                    "age",
                                    "accent",
                                    "description",
                                    "use_case",
                                    "use case",
                                )
                                and isinstance(v, str)
                                and v.strip()
                            ):
                                traits.append(v.strip())

                        # Case-insensitive deduplication
                        seen_traits: set[str] = set()
                        deduped_traits: list[str] = []
                        for t in traits:
                            cleaned = t.strip()
                            folded = cleaned.casefold()
                            if cleaned and folded not in seen_traits:
                                seen_traits.add(folded)
                                deduped_traits.append(cleaned)

                        voices.append(
                            Voice(
                                id=voice_id,
                                name=name_str,
                                language=self._language,
                                gender=gender_str,
                                age=age_str,
                                traits=deduped_traits,
                            )
                        )

                has_more = data.get("has_more") if isinstance(data, dict) else False
                next_page_token = data.get("next_page_token") if isinstance(data, dict) else None
                if not has_more or not next_page_token:
                    break
        finally:
            if should_close:
                await client.aclose()

        return voices

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        client = self._get_client()
        should_close = self._client is None
        headers = {
            "xi-api-key": self._api_key,
            "Content-Type": "application/json",
        }

        # Model support and speed validation
        is_v4 = "v4" in self.model_id.lower()
        if is_v4:
            if speed != 1.0:
                raise ValueError(
                    f"Model {self.model_id} does not support custom speed settings "
                    f"(expected 1.0, got {speed})"
                )
            payload: dict[str, Any] = {
                "text": text,
                "model_id": self.model_id,
            }
        else:
            if speed < 0.7 or speed > 1.2:
                raise ValueError(
                    f"ElevenLabs speed must be between 0.7 and 1.2 for model {self.model_id}, "
                    f"got {speed}"
                )
            payload = {
                "text": text,
                "model_id": self.model_id,
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "style": 0.0,
                    "use_speaker_boost": True,
                    "speed": speed,
                },
            }

        url = f"{self.base_url}/v1/text-to-speech/{voice_id}?output_format=wav_24000"

        try:
            response = await client.post(url, headers=headers, json=payload)
            request_id = response.headers.get("request-id") or response.headers.get("x-request-id")
            req_info = f" (request_id={request_id})" if request_id else ""

            if not response.is_success:
                try:
                    error_data = response.json()
                    detail = _parse_error_detail(error_data)
                except Exception:
                    detail = response.text or "Unknown error"
                raise RuntimeError(
                    f"ElevenLabs synthesis failed ({response.status_code}): {detail}{req_info}"
                )

            audio_bytes = response.content
            # Verify WAV header: RIFF....WAVE
            if len(audio_bytes) < 12 or audio_bytes[:4] != b"RIFF" or audio_bytes[8:12] != b"WAVE":
                raise RuntimeError(f"ElevenLabs response is not a valid WAV file{req_info}")

            return audio_bytes
        finally:
            if should_close:
                await client.aclose()
