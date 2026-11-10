from __future__ import annotations

from teller.assets import kokoro_asset_paths
from teller.config import AppConfig
from teller.providers.protocols import LLMProvider, TTSProvider
from teller.secrets import get_api_key


def create_llm(config: AppConfig) -> LLMProvider:
    if config.llm.provider == "gemini":
        from teller.providers.llm_gemini import GeminiLLM

        api_key = get_api_key("gemini", config.llm.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Gemini API key not found. Set {config.llm.api_key_env} or run: teller setup"
            )
        return GeminiLLM(api_key, config.llm.model)
    if config.llm.provider == "ollama":
        from teller.providers.llm_ollama import OllamaLLM

        return OllamaLLM(
            config.llm.model,
            config.llm.base_url or "http://localhost:11434",
        )
    raise ValueError(f"Unsupported LLM provider: {config.llm.provider}")


def create_tts(config: AppConfig) -> TTSProvider:
    if config.tts.provider == "gemini":
        from teller.providers.tts_gemini import GeminiTTS

        api_key = get_api_key("gemini", config.tts.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Gemini API key not found. Set {config.tts.api_key_env} or run: teller setup"
            )
        return GeminiTTS(api_key, config.tts.model)
    if config.tts.provider == "elevenlabs":
        from teller.providers.tts_elevenlabs import ElevenLabsTTS

        env_var = (
            config.tts.api_key_env
            if config.tts.api_key_env and config.tts.api_key_env != "GEMINI_API_KEY"
            else "ELEVENLABS_API_KEY"
        )
        api_key = get_api_key("elevenlabs", env_var)
        if not api_key:
            raise RuntimeError(f"ElevenLabs API key not found. Set {env_var} or run: teller setup")
        model = (
            config.tts.model
            if config.tts.model and config.tts.model != "gemini-3.8-flash-lite-tts"
            else "eleven_multilingual_v2"
        )
        return ElevenLabsTTS(
            api_key,
            model=model,
            language=config.tts.language,
        )
    if config.tts.provider == "kokoro":
        from teller.providers.tts_kokoro import KokoroTTS

        model_path, voices_path = kokoro_asset_paths(config.paths.assets_dir)
        return KokoroTTS(
            model_path,
            voices_path,
            language=config.tts.language,
            model=config.tts.model,
        )
    raise ValueError(f"Unsupported TTS provider: {config.tts.provider}")
