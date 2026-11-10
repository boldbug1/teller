from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from teller.api_models import (
    CastUpdatePayload,
    ConfigUpdatePayload,
    DoctorCheckItem,
    DoctorResponse,
    HealthResponse,
    OperationEnvelope,
    OperationStartResponse,
    SecretPayload,
    SetupStatusResponse,
    StoryDetailResponse,
    StoryExportRequest,
    StoryExportResponse,
    StoryImportRequest,
    StoryPasteRequest,
    StorySummary,
    VoiceItem,
)
from teller.audio_export import slugify_filename, stitch_story_audio
from teller.assets import (
    KOKORO_MODEL_SHA256,
    KOKORO_VOICES_SHA256,
    ensure_kokoro_assets,
    file_sha256,
    kokoro_asset_paths,
)
from teller.cache import AudioCache, audio_cache_key
from teller.config import AppConfig, default_config_path, load_config, save_config
from teller.document import (
    extract_docx_text,
    extract_pdf_text,
    extract_story_title,
    extract_text_from_file,
)
from teller.models import VoiceAssignment
from teller.operations import operations
from teller.pipeline import TellerEngine
from teller.providers.factory import create_llm, create_tts
from teller.secrets import get_api_key, store_api_key
from teller.storage import StoryStore

security = HTTPBearer(auto_error=False)


def create_app(
    api_token: str | None = None,
    config: AppConfig | None = None,
) -> FastAPI:
    expected_token = api_token or os.environ.get("TELLER_API_TOKEN", "")

    app = FastAPI(title="Teller API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def get_current_config() -> AppConfig:
        return config if config is not None else load_config()

    def get_store() -> StoryStore:
        cfg = get_current_config()
        return StoryStore(cfg.paths.stories_dir)

    def verify_token(
        credentials: HTTPAuthorizationCredentials | None = Depends(security),  # noqa: B008
    ) -> None:
        if not expected_token:
            return
        if not credentials or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing or invalid Bearer authentication header",
            )
        if credentials.credentials != expected_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API token",
            )

    # Health endpoint is public for readiness checks
    @app.get("/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    # Protected routes router
    router = APIRouter(dependencies=[Depends(verify_token)])

    # -------------------------------------------------------------------------
    # Setup
    # -------------------------------------------------------------------------

    @router.get("/v1/setup/status", response_model=SetupStatusResponse)
    def setup_status() -> SetupStatusResponse:
        cfg = get_current_config()

        gemini_key = bool(get_api_key("gemini", "GEMINI_API_KEY"))
        groq_key = bool(get_api_key("groq", "GROQ_API_KEY"))
        elevenlabs_key = bool(get_api_key("elevenlabs", "ELEVENLABS_API_KEY"))

        ollama_reachable = False
        ollama_models: list[str] = []
        try:
            from ollama import Client

            response = Client(host=cfg.llm.base_url or "http://localhost:11434").list()
            ollama_models = [str(item.model) for item in response.models if item.model]
            ollama_reachable = True
        except Exception:
            ollama_reachable = False

        ollama_model_available = cfg.llm.model in ollama_models

        model_path, voices_path = kokoro_asset_paths(cfg.paths.assets_dir)
        kokoro_model_ok = model_path.exists() and file_sha256(model_path) == KOKORO_MODEL_SHA256
        kokoro_voices_ok = voices_path.exists() and file_sha256(voices_path) == KOKORO_VOICES_SHA256

        audio_output_ok = False
        try:
            import sounddevice

            audio_output_ok = bool(sounddevice.query_devices(kind="output"))
        except Exception:
            audio_output_ok = True

        llm_ready = (
            (cfg.llm.provider in ("rule_based", "heuristic", "offline"))
            or (cfg.llm.provider == "gemini" and gemini_key)
            or (cfg.llm.provider == "groq" and groq_key)
            or (cfg.llm.provider == "ollama" and ollama_reachable and ollama_model_available)
        )
        tts_ready = (
            (cfg.tts.provider == "gemini" and gemini_key)
            or (cfg.tts.provider == "kokoro" and kokoro_model_ok and kokoro_voices_ok)
            or (cfg.tts.provider == "elevenlabs" and elevenlabs_key)
        )

        return SetupStatusResponse(
            llm_provider=cfg.llm.provider,
            tts_provider=cfg.tts.provider,
            gemini_key_present=gemini_key,
            groq_key_present=groq_key,
            elevenlabs_key_present=elevenlabs_key,
            ollama_reachable=ollama_reachable,
            ollama_models=ollama_models,
            ollama_model_available=ollama_model_available,
            kokoro_model_present=kokoro_model_ok,
            kokoro_voices_present=kokoro_voices_ok,
            audio_output_available=audio_output_ok,
            ready=bool(llm_ready and tts_ready),
        )

    # -------------------------------------------------------------------------
    # Config & Secrets
    # -------------------------------------------------------------------------

    @router.get("/v1/config")
    def get_config_endpoint() -> dict[str, Any]:
        cfg = get_current_config()
        return cfg.model_dump(mode="json")

    @router.patch("/v1/config")
    def patch_config_endpoint(payload: ConfigUpdatePayload) -> dict[str, Any]:
        cfg = get_current_config()
        current_data = cfg.model_dump(mode="json")

        for section in ("llm", "tts", "playback", "paths"):
            patch_section = getattr(payload, section)
            if patch_section and isinstance(patch_section, dict):
                current_data[section].update(patch_section)

        new_config = AppConfig.model_validate(current_data)
        save_config(new_config)
        nonlocal config
        config = new_config
        return new_config.model_dump(mode="json")

    @router.post("/v1/secrets/{provider}")
    def set_secret(provider: str, payload: SecretPayload) -> dict[str, str]:
        clean_provider = provider.strip().lower()
        if not store_api_key(clean_provider, payload.key.strip()):
            env_name = f"{clean_provider.upper()}_API_KEY"
            os.environ[env_name] = payload.key.strip()
        return {"status": "ok", "provider": clean_provider}

    @router.delete("/v1/secrets/{provider}")
    def delete_secret(provider: str) -> dict[str, str]:
        clean_provider = provider.strip().lower()
        store_api_key(clean_provider, "")
        env_name = f"{clean_provider.upper()}_API_KEY"
        os.environ.pop(env_name, None)
        return {"status": "ok", "provider": clean_provider}

    @router.post("/v1/doctor", response_model=DoctorResponse)
    def run_doctor() -> DoctorResponse:
        cfg = get_current_config()
        checks: list[DoctorCheckItem] = []
        checks.append(
            DoctorCheckItem(
                name="Config",
                passed=default_config_path().exists(),
                details=str(default_config_path()),
            )
        )

        # LLM Provider
        if cfg.llm.provider == "groq":
            present = bool(get_api_key("groq", "GROQ_API_KEY"))
            checks.append(
                DoctorCheckItem(
                    name="Groq API key",
                    passed=present,
                    details="GROQ_API_KEY",
                )
            )
            try:
                create_llm(cfg)
                checks.append(
                    DoctorCheckItem(name="Groq Provider", passed=True, details=f"model: {cfg.llm.model}")
                )
            except Exception as e:
                checks.append(DoctorCheckItem(name="Groq Provider", passed=False, details=str(e)))
        elif cfg.llm.provider in ("rule_based", "heuristic", "offline"):
            checks.append(
                DoctorCheckItem(
                    name="Rule-Based Engine",
                    passed=True,
                    details="100% offline & instant",
                )
            )
        elif cfg.llm.provider == "gemini":
            present = bool(get_api_key("gemini", cfg.llm.api_key_env))
            checks.append(
                DoctorCheckItem(
                    name="Gemini LLM key",
                    passed=present,
                    details=cfg.llm.api_key_env,
                )
            )
            try:
                create_llm(cfg)
                checks.append(
                    DoctorCheckItem(name="Gemini LLM SDK", passed=True, details="available")
                )
            except Exception as e:
                checks.append(DoctorCheckItem(name="Gemini LLM SDK", passed=False, details=str(e)))
        elif cfg.llm.provider == "ollama":
            try:
                from ollama import Client

                resp = Client(host=cfg.llm.base_url or "http://localhost:11434").list()
                available = [str(m.model) for m in resp.models if m.model]
                checks.append(
                    DoctorCheckItem(
                        name="Ollama",
                        passed=cfg.llm.model in available,
                        details=f"models: {', '.join(available) or 'none'}",
                    )
                )
            except Exception as e:
                checks.append(DoctorCheckItem(name="Ollama", passed=False, details=str(e)))

        # TTS Provider
        if cfg.tts.provider == "gemini":
            present = bool(get_api_key("gemini", cfg.tts.api_key_env))
            checks.append(
                DoctorCheckItem(
                    name="Gemini TTS key",
                    passed=present,
                    details=cfg.tts.api_key_env,
                )
            )
            try:
                create_tts(cfg)
                checks.append(
                    DoctorCheckItem(name="Gemini TTS SDK", passed=True, details="available")
                )
            except Exception as e:
                checks.append(DoctorCheckItem(name="Gemini TTS SDK", passed=False, details=str(e)))
        elif cfg.tts.provider == "kokoro":
            model_path, voices_path = kokoro_asset_paths(cfg.paths.assets_dir)
            model_ok = model_path.exists() and file_sha256(model_path) == KOKORO_MODEL_SHA256
            voices_ok = voices_path.exists() and file_sha256(voices_path) == KOKORO_VOICES_SHA256
            checks.append(
                DoctorCheckItem(name="Kokoro model", passed=model_ok, details=str(model_path))
            )
            checks.append(
                DoctorCheckItem(name="Kokoro voices", passed=voices_ok, details=str(voices_path))
            )
            try:
                import kokoro_onnx  # noqa: F401

                create_tts(cfg)
                checks.append(DoctorCheckItem(name="Kokoro SDK", passed=True, details="available"))
            except Exception as e:
                checks.append(DoctorCheckItem(name="Kokoro SDK", passed=False, details=str(e)))
        elif cfg.tts.provider == "elevenlabs":
            env_var = (
                cfg.tts.api_key_env
                if cfg.tts.api_key_env and cfg.tts.api_key_env != "GEMINI_API_KEY"
                else "ELEVENLABS_API_KEY"
            )
            present = bool(get_api_key("elevenlabs", env_var))
            checks.append(
                DoctorCheckItem(name="ElevenLabs TTS key", passed=present, details=env_var)
            )
            try:
                create_tts(cfg)
                checks.append(
                    DoctorCheckItem(name="ElevenLabs TTS SDK", passed=True, details="available")
                )
            except Exception as e:
                checks.append(
                    DoctorCheckItem(name="ElevenLabs TTS SDK", passed=False, details=str(e))
                )

        return DoctorResponse(
            checks=checks,
            all_passed=all(c.passed for c in checks),
        )

    @router.post("/v1/assets/kokoro", response_model=OperationStartResponse)
    async def download_kokoro_assets() -> OperationStartResponse:
        cfg = get_current_config()
        op_id, is_new = await operations.get_or_create("kokoro_download", dedup_key="assets:kokoro")
        if not is_new:
            return OperationStartResponse(operation_id=op_id)

        async def _download_task() -> None:
            await operations.update(
                op_id,
                state="running",
                message_code="downloading_assets",
            )
            try:
                loop = asyncio.get_running_loop()

                def progress(msg: str) -> None:
                    comp = 0
                    if ":" in msg and "%" in msg:
                        try:
                            fname, pct_part = msg.split(":")
                            pct = int(pct_part.strip().rstrip("%"))
                            comp = int(pct * 0.6) if "onnx" in fname else 60 + int(pct * 0.4)
                        except Exception:
                            comp = 0
                    try:
                        asyncio.run_coroutine_threadsafe(
                            operations.update(
                                op_id,
                                completed=comp,
                                total=100,
                                message_code=msg,
                            ),
                            loop,
                        )
                    except Exception:
                        pass

                await asyncio.to_thread(ensure_kokoro_assets, cfg.paths.assets_dir, progress)
                await operations.update(
                    op_id,
                    state="completed",
                    completed=100,
                    total=100,
                    message_code="download_complete",
                )
            except Exception as e:
                await operations.update(
                    op_id,
                    state="failed",
                    error=str(e),
                    message_code="download_failed",
                )

        task = asyncio.create_task(_download_task())
        operations.set_task(op_id, task)
        return OperationStartResponse(operation_id=op_id)

    # -------------------------------------------------------------------------
    # Stories
    # -------------------------------------------------------------------------

    @router.get("/v1/stories", response_model=list[StorySummary])
    def list_stories() -> list[StorySummary]:
        store = get_store()
        projects = store.list_stories()
        summaries: list[StorySummary] = []
        for p in projects:
            analysis = store.load_analysis(p)
            segments = analysis[0] if analysis else []
            characters = analysis[1] if analysis else []
            audio_dir = p.path / "audio"
            rendered_count = len(list(audio_dir.glob("*.wav"))) if audio_dir.exists() else 0

            summaries.append(
                StorySummary(
                    story_id=p.manifest.story_id,
                    title=p.manifest.title,
                    source_name=p.manifest.source_name,
                    created_at=p.manifest.created_at,
                    segment_count=len(segments),
                    character_count=len(characters),
                    rendered_segment_count=rendered_count,
                    has_analysis=analysis is not None,
                )
            )
        return summaries

    @router.post("/v1/stories/import", response_model=StorySummary)
    def import_story(payload: StoryImportRequest) -> StorySummary:
        text: str = ""
        filename_hint: str | None = payload.filename

        if payload.path:
            path = Path(payload.path).expanduser().resolve()
            if not path.exists() or not path.is_file():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Import file does not exist: {payload.path}",
                )
            filename_hint = filename_hint or path.name
            try:
                text = extract_text_from_file(path)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to read file: {e}",
                ) from e
        elif payload.content_base64:
            import base64

            try:
                data = base64.b64decode(payload.content_base64)
                ext = Path(payload.filename or "").suffix.lower()
                if ext == ".docx":
                    text = extract_docx_text(data)
                elif ext == ".pdf":
                    text = extract_pdf_text(data)
                else:
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        text = data.decode("latin-1")
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to process uploaded file: {e}",
                ) from e
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either file path or file content must be provided",
            )

        if not text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Story content is empty",
            )

        store = get_store()
        title = (
            payload.title.strip()
            if payload.title and payload.title.strip()
            else extract_story_title(text, filename_hint)
        )
        project = store.open_or_create(text, title, source_name=filename_hint)
        return StorySummary(
            story_id=project.manifest.story_id,
            title=project.manifest.title,
            source_name=project.manifest.source_name,
            created_at=project.manifest.created_at,
            segment_count=0,
            character_count=0,
            rendered_segment_count=0,
            has_analysis=False,
        )

    @router.post("/v1/stories/paste", response_model=StorySummary)
    def paste_story(payload: StoryPasteRequest) -> StorySummary:
        text = payload.text.strip()
        if not text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pasted text cannot be empty",
            )
        store = get_store()
        title = (
            payload.title.strip()
            if payload.title and payload.title.strip()
            else extract_story_title(text)
        )
        project = store.open_or_create(text, title, source_name=None)
        return StorySummary(
            story_id=project.manifest.story_id,
            title=project.manifest.title,
            source_name=project.manifest.source_name,
            created_at=project.manifest.created_at,
            segment_count=0,
            character_count=0,
            rendered_segment_count=0,
            has_analysis=False,
        )

    @router.get("/v1/stories/{story_id}", response_model=StoryDetailResponse)
    def get_story(story_id: str) -> StoryDetailResponse:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Story {story_id} not found",
            ) from err
        text = store.story_text(project)
        analysis = store.load_analysis(project)
        segments = analysis[0] if analysis else []
        characters = analysis[1] if analysis else []
        audio_dir = project.path / "audio"
        rendered_count = len(list(audio_dir.glob("*.wav"))) if audio_dir.exists() else 0

        return StoryDetailResponse(
            manifest=project.manifest,
            text=text,
            segments=segments,
            characters=characters,
            rendered_count=rendered_count,
            total_count=len(segments),
        )

    @router.delete("/v1/stories/{story_id}")
    def delete_story_endpoint(story_id: str) -> dict[str, str]:
        store = get_store()
        try:
            store.delete_story(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Story {story_id} not found",
            ) from err
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        return {"status": "ok", "story_id": story_id}

    # -------------------------------------------------------------------------
    # Analysis, Rendering, and Cast
    # -------------------------------------------------------------------------

    @router.post("/v1/stories/{story_id}/analyze", response_model=OperationStartResponse)
    async def analyze_story(
        story_id: str,
        force: bool = False,
    ) -> OperationStartResponse:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        op_id, is_new = await operations.get_or_create("analyze", dedup_key=f"{story_id}:analyze")
        if not is_new:
            return OperationStartResponse(operation_id=op_id)

        cfg = get_current_config()
        try:
            llm = create_llm(cfg)
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(err),
            ) from err

        async def _run_analysis() -> None:
            await operations.update(
                op_id,
                state="running",
                completed=0,
                total=1,
                message_code="Starting story analysis...",
            )
            try:
                engine = TellerEngine(cfg, llm=llm)

                def progress_cb(comp: int, tot: int, code: str) -> None:
                    asyncio.create_task(
                        operations.update(op_id, completed=comp, total=tot, message_code=code)
                    )

                def is_canc() -> bool:
                    return operations.is_cancelled(op_id)

                segments, characters = await engine.analyze(
                    project,
                    force=force,
                    progress_callback=progress_cb,
                    is_cancelled=is_canc,
                )
                await operations.update(
                    op_id,
                    state="completed",
                    completed=len(segments),
                    total=len(segments),
                    message_code="Analysis complete!",
                )
            except asyncio.CancelledError:
                await operations.update(
                    op_id, state="cancelled", message_code="Analysis cancelled"
                )
            except Exception as e:
                await operations.update(
                    op_id, state="failed", error=str(e), message_code=f"Analysis failed: {e}"
                )

        task = asyncio.create_task(_run_analysis())
        operations.set_task(op_id, task)
        return OperationStartResponse(operation_id=op_id)

    @router.post("/v1/stories/{story_id}/render", response_model=OperationStartResponse)
    async def render_story(story_id: str) -> OperationStartResponse:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Story must be analyzed before rendering",
            )

        op_id, is_new = await operations.get_or_create("render", dedup_key=f"{story_id}:render")
        if not is_new:
            return OperationStartResponse(operation_id=op_id)

        cfg = get_current_config()

        async def _run_render() -> None:
            await operations.update(op_id, state="running", message_code="render_started")
            try:
                tts = create_tts(cfg)
                engine = TellerEngine(cfg, tts=tts)

                segments, characters = analysis
                if any(c.voice is None for c in characters):
                    characters = await engine.prepare_voices(project, segments, characters)

                def progress_cb(comp: int, tot: int, code: str) -> None:
                    asyncio.create_task(
                        operations.update(op_id, completed=comp, total=tot, message_code=code)
                    )

                def is_canc() -> bool:
                    return operations.is_cancelled(op_id)

                await engine.render(
                    project,
                    segments,
                    characters,
                    progress_callback=progress_cb,
                    is_cancelled=is_canc,
                )
                await operations.update(
                    op_id,
                    state="completed",
                    completed=len(segments),
                    total=len(segments),
                    message_code="render_completed",
                )
            except asyncio.CancelledError:
                await operations.update(
                    op_id, state="cancelled", message_code="operation_cancelled"
                )
            except Exception as e:
                await operations.update(
                    op_id, state="failed", error=str(e), message_code="render_failed"
                )

        task = asyncio.create_task(_run_render())
        operations.set_task(op_id, task)
        return OperationStartResponse(operation_id=op_id)

    @router.post("/v1/stories/{story_id}/reassign-voices", response_model=OperationStartResponse)
    async def reassign_voices(story_id: str) -> OperationStartResponse:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Story must be analyzed before assigning voices",
            )

        op_id, is_new = await operations.get_or_create(
            "reassign_voices", dedup_key=f"{story_id}:reassign_voices"
        )
        if not is_new:
            return OperationStartResponse(operation_id=op_id)

        cfg = get_current_config()

        async def _run_reassign() -> None:
            await operations.update(op_id, state="running", message_code="reassigning_voices")
            try:
                tts = create_tts(cfg)
                engine = TellerEngine(cfg, tts=tts)
                segments, characters = analysis
                await engine.prepare_voices(project, segments, characters, force=True)
                await operations.update(
                    op_id,
                    state="completed",
                    completed=len(characters),
                    total=len(characters),
                    message_code="voices_reassigned",
                )
            except Exception as e:
                await operations.update(
                    op_id, state="failed", error=str(e), message_code="reassign_failed"
                )

        task = asyncio.create_task(_run_reassign())
        operations.set_task(op_id, task)
        return OperationStartResponse(operation_id=op_id)

    @router.get("/v1/stories/{story_id}/cast")
    def get_cast(story_id: str) -> list[Any]:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err
        characters = store.load_characters(project)
        if characters is None:
            return []
        return [c.model_dump(mode="json") for c in characters]

    @router.patch("/v1/stories/{story_id}/cast/{character_id}")
    def update_character_voice(
        story_id: str,
        character_id: str,
        payload: CastUpdatePayload,
    ) -> dict[str, Any]:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Story has not been analyzed",
            )
        segments, characters = analysis
        target_char = next((c for c in characters if c.id == character_id), None)
        if not target_char:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Character {character_id} not found in cast",
            )

        cfg = get_current_config()
        provider = payload.provider or cfg.tts.provider
        model = payload.model or cfg.tts.model

        target_char.voice = VoiceAssignment(
            provider=provider,
            model=model,
            voice_id=payload.voice_id,
            language=payload.language or cfg.tts.language,
        )
        store.save_characters(project, characters)
        return target_char.model_dump(mode="json")

    @router.get("/v1/voices", response_model=list[VoiceItem])
    async def list_available_voices() -> list[VoiceItem]:
        cfg = get_current_config()
        try:
            tts = create_tts(cfg)
            voices = await tts.list_voices()
            return [
                VoiceItem(
                    id=v.id,
                    name=v.name,
                    language=v.language,
                    gender=v.gender,
                    age=v.age,
                    traits=v.traits,
                )
                for v in voices
            ]
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to fetch voices: {e}",
            ) from e

    # -------------------------------------------------------------------------
    # Audio Retrieval
    # -------------------------------------------------------------------------

    @router.get("/v1/stories/{story_id}/segments/{segment_index}/audio")
    def get_segment_audio(
        story_id: str,
        segment_index: int,
    ) -> Response:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No analysis found")
        segments, characters = analysis
        matching = [s for s in segments if s.index == segment_index]
        if not matching:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Segment not found")
        segment = matching[0]

        char_map = {c.id: c for c in characters}
        character = char_map.get(segment.speaker_id)
        if not character or not character.voice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Speaker has no assigned voice",
            )

        cfg = get_current_config()
        cache = AudioCache(project.path / "audio")
        key = audio_cache_key(
            provider=character.voice.provider,
            model=character.voice.model,
            voice_id=character.voice.voice_id,
            text=segment.text.strip(),
            style=segment.emotion,
            speed=cfg.tts.speed,
            language=cfg.tts.language,
        )
        audio = cache.get(key)
        if audio is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Segment audio not rendered yet",
            )
        return Response(content=audio, media_type="audio/wav")

    @router.get("/v1/stories/{story_id}/download")
    @router.get("/v1/stories/{story_id}/export/audio")
    def download_story_audio(
        story_id: str,
    ) -> Response:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Story not analyzed yet"
            )

        segments, characters = analysis
        cfg = get_current_config()

        try:
            wav_bytes, duration, count = stitch_story_audio(
                project,
                segments,
                characters,
                cfg,
                speaker_pause_ms=cfg.playback.speaker_pause_ms,
            )
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)
            ) from err

        filename = slugify_filename(project.manifest.title)
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(wav_bytes)),
                "X-Audio-Duration": str(duration),
                "X-Rendered-Segments": str(count),
            },
        )

    @router.post("/v1/stories/{story_id}/export", response_model=StoryExportResponse)
    def export_story_audio(
        story_id: str,
        payload: StoryExportRequest | None = None,
    ) -> StoryExportResponse:
        store = get_store()
        try:
            project = store.find(story_id)
        except FileNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
            ) from err

        analysis = store.load_analysis(project)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Story not analyzed yet"
            )

        segments, characters = analysis
        cfg = get_current_config()

        try:
            wav_bytes, duration, count = stitch_story_audio(
                project,
                segments,
                characters,
                cfg,
                speaker_pause_ms=cfg.playback.speaker_pause_ms,
            )
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)
            ) from err

        filename = slugify_filename(project.manifest.title)
        if payload and payload.target_path:
            target = Path(payload.target_path)
            if target.is_dir():
                target = target / filename
        else:
            downloads = Path.home() / "Downloads"
            target = (downloads if downloads.exists() else project.path) / filename

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(wav_bytes)

        return StoryExportResponse(
            path=str(target),
            filename=filename,
            size_bytes=len(wav_bytes),
            duration_seconds=duration,
            rendered_segments=count,
        )

    # -------------------------------------------------------------------------
    # Operations
    # -------------------------------------------------------------------------

    @router.get("/v1/operations/{operation_id}", response_model=OperationEnvelope)
    def get_operation(operation_id: str) -> OperationEnvelope:
        op = operations.get(operation_id)
        if not op:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Operation not found",
            )
        return op

    @router.post("/v1/operations/{operation_id}/cancel")
    async def cancel_operation_endpoint(operation_id: str) -> dict[str, str]:
        cancelled = await operations.cancel(operation_id)
        if not cancelled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Operation cannot be cancelled or was not found",
            )
        return {"status": "cancelled", "operation_id": operation_id}

    app.include_router(router)

    # -------------------------------------------------------------------------
    # WebSockets
    # -------------------------------------------------------------------------

    @app.websocket("/v1/events")
    async def websocket_events(websocket: WebSocket) -> None:
        await websocket.accept()
        if expected_token:
            try:
                auth_message = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
                data = json.loads(auth_message)
                if data.get("token") != expected_token:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

        await operations.register_subscriber(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await operations.unregister_subscriber(websocket)

    return app
