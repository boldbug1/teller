# AGENTS.md

Instructions, architecture principles, and invariants for autonomous AI agents and coding assistants working on the Teller codebase.

---

## 1. Project Mission & Architecture

Teller converts plain-text stories and books into multi-voice audio dramas.

### Dual-Runtime Layout

- **Frontend Desktop UI (`desktop/`)**:
  - React 19 + TypeScript + Vite.
  - Packaged by Tauri 2 (`desktop/src-tauri/`).
  - Native windowing without OS decorations (`decorations: false`). Window management (minimize, maximize, close) and dragging are handled via `@tauri-apps/api/window` and `data-tauri-drag-region`.
  - Communicates with the backend engine via HTTP client (`desktop/src/api/client.ts`) and WebSocket connection.

- **Backend Engine & Sidecar (`src/teller/`)**:
  - Python 3.10+ FastAPI server (`src/teller/server.py` and `src/teller/api.py`).
  - Dialogue extraction and speaker attribution (`src/teller/tagger.py`).
  - Voice assignment and character management (`src/teller/characters.py`).
  - Speech synthesis and audio caching pipeline (`src/teller/pipeline.py`).
  - Audio concatenation and WAV master export (`src/teller/audio_export.py`).
  - Compiled into a standalone binary `teller-sidecar-x86_64-pc-windows-msvc.exe` via PyInstaller (`scripts/build_sidecar.ps1`) for release packaging.

---

## 2. Core Invariants (Do Not Violate)

1. **Source Text Preservation**:
   - Teller parses dialogue and narration into discrete segments, but it must NEVER alter, summarize, censor, or rephrase the source text. Verbatim reassembly of all segment texts must reproduce the original manuscript identically.

2. **Deterministic Audio Cache**:
   - Every audio synthesis call must check the local `AudioCache` (`stories/<id>/audio/`) before issuing remote API requests.
   - Cache keys are generated via `audio_cache_key(...)` using text, voice ID, emotion style, speed, language, provider, and model.
   - Never bypass the cache or force remote synthesis unless explicitly requested by the user (`force=True`).

3. **Secure API Key Handling**:
   - Never store API keys in plain text files, source code, git commits, or story directories.
   - Keys must be retrieved and stored using `teller.secrets` (which wraps the system keyring / OS credential manager).
   - In the frontend, keys are write-only inputs that display masked status (e.g., "Stored in Keychain").

4. **Transparent Error Handling**:
   - Never silently swallow API errors, model 404s, or validation failures.
   - If an LLM provider fails during dialogue tagging, raise an informative error to the user rather than silently attributing all lines to Narrator or falling back to rule-based parsing without warning.

5. **Style System Integrity**:
   - The desktop app uses a single CSS stylesheet: `desktop/src/styles/paper-theatre.css`.
   - Do not install Tailwind, styled-components, or external UI component libraries. Use existing CSS custom properties (`--ink`, `--paper`, `--rust`, `--gold`, etc.).

---

## 3. Key Files & Responsibilities

| Path | Responsibility |
| --- | --- |
| `src/teller/api.py` | FastAPI routes, background operation management, server endpoints. |
| `src/teller/tagger.py` | Dialogue chunking, prompt generation, LLM structured schema tagging, and heuristic fallback. |
| `src/teller/pipeline.py` | `TellerEngine` orchestrating analysis, voice assignment, and audio rendering. |
| `src/teller/characters.py` | `CharacterRegistry` tracking character identities, aliases, and gender/trait metadata across chunks. |
| `src/teller/storage.py` | `StoryStore` managing local story projects, manifests, analysis files, and audio cache directories. |
| `src/teller/audio_export.py` | Multi-segment WAV stitching with pause padding and master audio download generation. |
| `src/teller/providers/` | Pluggable LLM and TTS clients (`llm_groq.py`, `llm_gemini.py`, `llm_ollama.py`, `tts_kokoro.py`, `tts_elevenlabs.py`). |
| `desktop/src/App.tsx` | Main application shell, state coordination, and modal orchestration. |
| `desktop/src/components/StoryScene.tsx` | Main stage view: title header, dialogue stream, karaoke word highlighting, empty state. |
| `desktop/src/components/CastRail.tsx` | Right rail displaying the character cast, assigned voices, and auto-cast controls. |
| `desktop/src/components/StoryRail.tsx` | Left rail showing the story library, segment counts, and add story trigger. |
| `desktop/src/components/Transport.tsx` | Fixed bottom media player with scrubber, play/pause, and volume controls. |
| `desktop/src/components/Header.tsx` | Custom titlebar with logo, Doctor diagnostics modal trigger, Settings trigger, and Windows controls. |
| `desktop/src-tauri/tauri.conf.json` | Tauri configuration: window dimensions, bundle icon list, externalBin declaration. |
| `scripts/build_sidecar.ps1` | PyInstaller build script for creating the single-file sidecar executable. |

---

## 4. Dialogue Tagging & Schema Contract

When sending tagging requests to LLMs, pass `TaggingResult.model_json_schema()` directly in the prompt or system instruction:

```python
class UnitAssignment(BaseModel):
    unit_id: str
    speaker_ref: str
    emotion: str | None = None

class CharacterObservation(BaseModel):
    ref: str
    name: str
    aliases: list[str] = []
    gender: str | None = None
    age: str | None = None
    traits: list[str] = []

class TaggingResult(BaseModel):
    assignments: list[UnitAssignment]
    characters: list[CharacterObservation] = []
```

### Validation & Normalization Rules

- Character refs returned by models must be normalized in `_validate_result`. If an LLM returns a natural ID like `"hare"` instead of `"new_hare"`, auto-prefix it with `new_` to preserve downstream registry tracking without failing validation.
- All non-whitespace spoken units in a chunk must be assigned exactly once.
- Unattributed dialogue or narration defaults to `"narrator"`.

---

## 5. Verification Commands

When modifying code, verify changes using these commands:

### Backend Testing & Type Checking

```bash
# Activate virtual environment
.venv\Scripts\activate

# Run unit tests
pytest

# Type check backend
mypy src/teller
```

### Frontend Type Checking & Testing

```bash
cd desktop

# Run TypeScript compilation and Vite build
npm run build

# Run frontend tests
npm test
```

### Sidecar & Package Verification

When backend files (`src/teller/`) are altered, the PyInstaller sidecar must be rebuilt for packaged testing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build_sidecar.ps1
```

To verify the complete packaged Tauri application:

```bash
cd desktop
npm run tauri build
```

---

## 6. Communication & Style Guidelines

- **Zero Emojis**: Never use emoji characters in documentation, code comments, commit messages, or user responses.
- **Directness**: Keep technical explanations clear, concise, and focused on implementation specifics.
- **Respect User Constraints**: If the user instructs not to run tests or specifies a design direction, strictly follow that guidance.
