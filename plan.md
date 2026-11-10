# Teller Desktop Implementation Plan

## Status

This document is the implementation contract for Teller's first desktop release.
It records the decisions agreed before coding starts and should be updated when a
decision changes materially.

## Product Decisions

- Build a local desktop application. No hosted Teller service is required.
- Optimize the first packaged release for Windows x64.
- Use Tauri 2 as the desktop shell.
- Use Vite, React, and TypeScript for the frontend.
- Keep the existing Python package as the only source of business logic.
- Run Python as a local sidecar process managed by Tauri.
- Use Ollama as the first local LLM runtime.
- Keep Kokoro ONNX as the first local TTS runtime.
- Keep Gemini as a cloud LLM and TTS option.
- Add ElevenLabs as a cloud TTS option.
- Preserve BYOK: API keys remain on the user's machine.
- Use the Paper Theatre prototype as the production visual direction.
- Keep the add-story control permanently at the top of the story rail. Only the
  story list below it may scroll.
- Download large model files on demand instead of embedding them in the installer.
- Keep the existing CLI operational and backed by the same engine.

## Goals

1. Import or paste a plain-text story.
2. Analyze narration, characters, dialogue, and emotion using Gemini or Ollama.
3. Assign and persist voices from Gemini, Kokoro, or ElevenLabs.
4. Render missing audio while preserving the existing deterministic cache.
5. Play, pause, seek, skip, and resume through a desktop-native-looking player.
6. Display rendering and setup progress without freezing the interface.
7. Store API keys in the operating system credential manager.
8. Work fully offline after Ollama, Kokoro assets, and an Ollama model are present.
9. Install as a normal Windows application without requiring a user-managed Python
   installation.
10. Remain straightforward for open-source contributors to run from source.

## Non-Goals For The First Release

- Hosting a public web service.
- Mobile applications.
- Bundling Ollama itself into Teller.
- Bundling Ollama model weights in the Teller installer.
- macOS or Linux release artifacts in the first packaging milestone.
- Account synchronization, cloud story storage, or telemetry.
- Voice cloning or voice uploads.
- Rewriting the Python engine in Rust or TypeScript.
- A marketplace or plugin system for providers.

## High-Level Architecture

```text
Tauri 2 process
  |-- Windows application lifecycle
  |-- native file dialogs
  |-- narrow sidecar permissions
  |-- starts and stops the Teller Python sidecar
  |-- exposes sidecar readiness to the webview
  `-- packages the static Vite build

React webview
  |-- Paper Theatre interface
  |-- story library and cast controls
  |-- setup and provider configuration
  |-- operation progress and errors
  `-- Web Audio playback and segment preloading

Python sidecar bound to 127.0.0.1
  |-- authenticated FastAPI application
  |-- TellerEngine orchestration
  |-- StoryStore and AudioCache
  |-- provider creation and credential lookup
  |-- Ollama, Gemini, Kokoro, and ElevenLabs adapters
  `-- operation registry and progress events
```

The frontend must not duplicate attribution, voice assignment, cache, or provider
logic. The CLI and desktop API both call the same Python classes.

## Proposed Repository Layout

```text
desktop/
  package.json
  package-lock.json
  index.html
  tsconfig.json
  vite.config.ts
  src/
    main.tsx
    App.tsx
    api/
    audio/
    components/
    hooks/
    styles/
    types/
  src-tauri/
    Cargo.toml
    build.rs
    tauri.conf.json
    capabilities/
    icons/
    src/
    binaries/

src/teller/
  api.py
  api_models.py
  operations.py
  server.py
  providers/
    tts_elevenlabs.py

scripts/
  build_sidecar.ps1

prototypes/frontend-variations/
  paper-theatre.html
  ...
```

The prototype files remain reference artifacts. Production UI code lives under
`desktop/`.

## Technology Choices

### Frontend

- React 19 and TypeScript.
- Vite for development and static production builds.
- CSS Modules or component-scoped plain CSS, backed by shared design tokens.
- TanStack Query for deduplicated API reads, mutations, and operation polling.
- Native Web Audio APIs for playback.
- Inline SVG for the illustrated icon language.
- Vitest and React Testing Library for component tests.

Do not use Next.js, server-side rendering, a utility CSS framework, or a generic
component library. They do not help a local static application and would make the
Paper Theatre visual language harder to preserve.

### Desktop Shell

- Tauri 2.
- `tauri-plugin-dialog` for import dialogs.
- `tauri-plugin-shell` only for the declared Teller sidecar.
- `tauri-plugin-single-instance` to avoid duplicate sidecars.
- Tauri updater support after signed releases exist.
- The normal Windows title bar for the first release. A custom title bar can be a
  later visual refinement.

### Python API

- FastAPI for typed local endpoints.
- Uvicorn for the loopback server.
- Pydantic models shared with the current domain models where practical.
- An in-memory operation registry for analysis and rendering jobs.
- WebSocket events for live progress; REST operation status remains available as a
  fallback and for reconnection.

### Distribution

- Package the Python server as a Windows x64 sidecar with PyInstaller first.
- Run a packaging spike before depending on the final sidecar shape.
- Start with one-file packaging for the spike because it maps directly to Tauri's
  `externalBin` contract. Move to a bundled directory or Nuitka standalone build
  if startup time, antivirus false positives, or native library discovery make
  one-file packaging unsuitable.
- Produce an NSIS Windows installer through Tauri.
- Use GitHub Actions and GitHub Releases when release automation is added.

## Local API Security

The API is local, but it still needs protection from unrelated browser pages and
local processes.

1. Bind only to `127.0.0.1`, never `0.0.0.0`.
2. Tauri generates a cryptographically random bearer token for each app launch.
3. The token is passed to the sidecar through a protected process argument or
   environment variable.
4. The sidecar prints one machine-readable readiness line containing its selected
   random port, not the token.
5. Tauri exposes the port and token to the main webview through a narrow command.
6. Every API endpoint except process readiness requires the bearer token.
7. WebSockets authenticate with their first message instead of putting the token
   in the URL.
8. CORS accepts only the Tauri origin and the configured Vite development origin.
9. The Tauri Content Security Policy permits connections only to the selected
   loopback server and required development addresses.
10. Logs must never contain API keys, bearer tokens, full request headers, or story
    text by default.

## Sidecar Lifecycle

1. Tauri creates a launch token.
2. Tauri starts the packaged sidecar with an ephemeral port request.
3. Python binds to an available loopback port and prints a JSON readiness event.
4. Tauri stores the child handle and connection information.
5. React requests connection information through a Tauri command.
6. React performs a health check and shows a recoverable startup state if needed.
7. Tauri terminates the sidecar when the main process exits.
8. A second application launch focuses the existing window instead of starting a
   second sidecar.
9. Sidecar crashes produce a visible recovery action and an inspectable local log.

In development, a normal Python process may run beside the Vite server. Production
must use the packaged sidecar.

## Desktop Data Locations

- Desktop configuration: platform user configuration directory.
- Stories: platform user data directory under `stories/`.
- Downloaded Kokoro assets: platform user data directory under `models/`.
- Logs: platform user log directory.
- Secrets: operating system credential manager through the existing keyring layer.

The current CLI default of a relative `stories/` folder must not cause a packaged
application to write inside its install directory. Desktop startup will supply a
desktop-specific configuration path and initialize its story directory explicitly.
Existing CLI users keep their configured behavior.

## Local API Contract

The exact schemas may evolve during implementation, but endpoint responsibilities
must remain separated from domain logic.

### Process And Setup

```text
GET    /v1/health
GET    /v1/setup/status
GET    /v1/config
PATCH  /v1/config
POST   /v1/secrets/{provider}
DELETE /v1/secrets/{provider}
POST   /v1/doctor
POST   /v1/assets/kokoro
```

`/v1/setup/status` reports provider availability, credential presence, Ollama
reachability, selected Ollama model availability, Kokoro asset state, and audio
runtime state. It never returns secret values.

### Stories

```text
GET    /v1/stories
POST   /v1/stories/import
POST   /v1/stories/paste
GET    /v1/stories/{story_id}
DELETE /v1/stories/{story_id}
```

Import accepts a path selected by the native dialog. Paste accepts story text and
an optional title. Deletion requires explicit confirmation in the UI and should
prefer a recoverable trash operation when practical.

### Analysis, Rendering, And Cast

```text
POST   /v1/stories/{story_id}/analyze
POST   /v1/stories/{story_id}/render
POST   /v1/stories/{story_id}/reassign-voices
GET    /v1/stories/{story_id}/cast
PATCH  /v1/stories/{story_id}/cast/{character_id}
GET    /v1/voices
```

Long-running endpoints return an operation ID immediately. Repeated requests for
the same active story operation must not start duplicate paid or local work.

### Operations

```text
GET    /v1/operations/{operation_id}
POST   /v1/operations/{operation_id}/cancel
WS     /v1/events
```

Operation events have a stable envelope:

```json
{
  "operation_id": "opaque-id",
  "kind": "render",
  "state": "running",
  "completed": 8,
  "total": 24,
  "message_code": "segment_rendered",
  "error": null
}
```

`message_code` is machine-oriented. The frontend owns user-facing wording. Errors
are sanitized and include a support-safe diagnostic code.

### Audio

```text
GET /v1/stories/{story_id}/segments/{segment_index}/audio
```

The frontend fetches audio with its bearer header, converts it to an object URL or
AudioBuffer, and revokes/releases it after use. Do not expose arbitrary filesystem
paths to the webview.

## Engine Changes Required For The API

- Add story listing to `StoryStore` with deterministic ordering and malformed
  project isolation.
- Keep all writes atomic.
- Add optional progress callbacks to analysis, voice preparation, and rendering.
- Preserve the existing single-flight cache behavior so identical paid requests
  cannot race.
- Add cancellation checks between safe units of work.
- Keep cached reads usable without provider credentials.
- Separate rendering from playback for the desktop path. Python renders WAV data;
  the frontend plays it.
- Preserve `SoundDevicePlayer` for the CLI.
- Avoid holding story text, generated audio, or credentials in global API state.
- Reject paths outside configured story and import scopes.

## ElevenLabs TTS Support

### Provider Identity And Defaults

- Provider ID: `elevenlabs`.
- API key environment variable: `ELEVENLABS_API_KEY`.
- Credential-store username: `elevenlabs` under the existing `teller` service.
- Initial recommended model: `eleven_multilingual_v2` for stable long-form output
  and conventional speed controls.
- Allow advanced users to configure other model IDs, including `eleven_v4`.
- Output format: `wav_24000`.
- API base URL: `https://api.elevenlabs.io`.

Use direct REST requests with `httpx.AsyncClient`. A vendor SDK is unnecessary for
the small API surface and would increase sidecar size.

### REST Calls

```text
GET  /v2/voices?page_size=100&include_total_count=false
POST /v1/text-to-speech/{voice_id}?output_format=wav_24000
```

Authentication uses the `xi-api-key` header. Voice pagination follows `has_more`
and `next_page_token` until complete.

The synthesis body includes:

```json
{
  "text": "Exact source text",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": true,
    "speed": 1.0
  }
}
```

For models that do not support this settings surface, notably v4, send only the
supported fields. Teller's emotion string is not ElevenLabs' numeric style value;
do not speak it or map it implicitly. The adapter accepts the protocol argument
but leaves style at the documented neutral value.

### Speed Rules

- Validate speed inside the ElevenLabs adapter rather than narrowing Teller's
  global `0.5` to `2.0` range.
- Models using the conventional ElevenLabs voice settings accept `0.7` to `1.2`.
- Models without speed support require the default speed of `1.0` and return a
  clear configuration error otherwise.

### Voice Mapping

- `voice_id` maps to `Voice.id`.
- Voice name falls back to the ID when absent.
- Labels such as gender and age map to their dedicated fields.
- Accent, use case, category, and descriptive labels become de-duplicated traits.
- Do not assign one arbitrary verified language to a multilingual voice. Use the
  configured target language consistently or leave voice language unset so voice
  assignment does not accidentally filter valid voices.
- Missing and nullable API metadata must not fail the whole voice list.

### Audio And Errors

- Require a successful HTTP status before accepting response bytes.
- Verify `RIFF` and `WAVE` headers before returning audio to `AudioCache`.
- Never cache JSON or HTML error responses as WAV files.
- Preserve ElevenLabs request IDs in sanitized errors for support.
- Handle error `detail` values that are objects, arrays, strings, or absent.
- Do not automatically retry ambiguous network timeouts because a duplicate request
  can consume credits twice.
- A received 429 or transient service response may be retried later through an
  explicit operation retry policy with capped backoff.
- Respect the configured Teller concurrency. Default cloud concurrency may need to
  be reduced for free ElevenLabs plans.

### Cache Contract

The current cache already includes provider, model, voice ID, text, emotion, speed,
language, and WAV format. Fixed ElevenLabs generation settings are part of the
adapter revision. Changing those constants or the output format requires a cache
schema/revision change so old and new output are not conflated.

### Factory, CLI, And Doctor

- Add a lazy `elevenlabs` TTS branch in `providers/factory.py`.
- Obtain the key through `get_api_key("elevenlabs", api_key_env)`.
- Do not require ElevenLabs dependencies for local-only installations.
- Keep `setup --mode cloud` defaulting to Gemini for both jobs.
- Add an explicit TTS selection path so Gemini can handle attribution while
  ElevenLabs handles speech.
- Store the ElevenLabs key through the same keyring abstraction.
- Refactor `doctor` to check LLM and TTS providers independently. Its current
  provider pairing assumption is invalid for Gemini plus ElevenLabs.
- Keep mixed-provider configuration explicit in `config.example.toml` and README.
- Switching a saved story's TTS provider requires voice reassignment before
  uncached generation.

### ElevenLabs Tests

- Paginated voice listing.
- Missing/null voice metadata.
- Trait de-duplication and language policy.
- Exact authentication header, URL, output format, and request body.
- Valid v2 speed settings.
- Invalid speed errors.
- v4 settings behavior.
- Emotion strings are not inserted into speech text or numeric style.
- Valid WAV response acceptance.
- Non-WAV success response rejection.
- Structured and unstructured API errors.
- Factory selection and missing-key behavior.
- Mixed Gemini-LLM/ElevenLabs-TTS doctor behavior.
- No real ElevenLabs network calls in the normal test suite.

## Paper Theatre Production UI

### Visual Direction

- Warm paper, ink, rust, gold, and sage palette from the prototype.
- Thin hand-drawn borders, offset shadows, restrained paper grain, and illustrated
  story art.
- Icon-first transport and utility controls.
- Visible text where comprehension requires it: story titles, setup choices,
  errors, character names, and provider configuration.
- Accessible names for every icon-only control.
- Keyboard focus that is clearly visible and consistent with the art direction.
- Respect `prefers-reduced-motion`.

### Story Rail And Add Control

Desktop behavior:

```text
left story rail
  |-- fixed add-story button at the top
  `-- independently scrollable story list below it
```

The add button must never be appended after story cards and must remain reachable
regardless of library size. The story rail owns its scroll area; the main player
does not shift as stories are added.

Mobile behavior:

```text
horizontal story strip
  |-- sticky add-story button at the left
  `-- horizontally scrollable story cards to its right
```

The sticky button receives an opaque background and higher stacking order so cards
do not show through it.

### Main Surface

- Story artwork and state illustration occupy the upper page.
- Story title and current segment are readable without overwhelming the art.
- The player remains available while navigating the cast or library.
- Analysis/rendering states alter the illustration and waveform rather than
  replacing the whole page with a generic spinner.
- Empty, setup-required, failed, and ready states each have a deliberate scene.

### Cast Rail

- Character portrait, name, assigned voice, and activity meter.
- Voice selection opens a focused picker populated by the configured TTS provider.
- Changing providers does not silently rewrite existing assignments.
- Reassignment clearly distinguishes one character from the whole cast.

### Playback

- Play/pause, previous segment, next segment, seek, and volume.
- Preload only a small lookahead window of segment audio.
- Revoke object URLs and release decoded buffers when no longer needed.
- Maintain a map from segment durations to overall story progress.
- Insert the configured speaker pause between different speakers.
- Handle missing audio by requesting rendering and displaying progress.
- Continue from the nearest valid segment after recoverable errors.

## Frontend Component Boundaries

```text
App
  SetupGate
  PaperTheatreShell
    AppHeader
    StoryRail
      AddStoryButton
      StoryCardList
    StoryPage
      StoryScene
      SegmentPreview
      OperationState
    CastRail
      CharacterVoiceCard
    Transport
      Waveform
      PlaybackControls
    ProviderSettingsDialog
    VoicePickerDialog
    ImportDialog
```

Components should remain small where state ownership is clear, but avoid wrapper
components that exist only for styling. Static SVG and decoration should be hoisted
out of frequently rerendered player state.

## Frontend State Rules

- Server state belongs in TanStack Query.
- Playback timing and transient audio state belong in a dedicated audio controller
  hook backed by refs, not global React rerenders on every animation frame.
- Derive selected-story views during render instead of mirroring them in effects.
- Use transitions for non-urgent library and cast updates.
- Fetch independent setup resources in parallel.
- Do not persist secrets or bearer tokens in localStorage.
- Persist only safe UI preferences, versioned with a small schema.

## Provider Setup UX

### Local Mode

1. Detect Ollama.
2. List available Ollama models.
3. Offer the configured recommended model when absent.
4. Detect Kokoro runtime and assets.
5. Download checksum-verified Kokoro assets with visible byte progress.
6. Run provider checks.
7. Mark the app ready for offline use.

Teller does not silently install or start privileged third-party software. Ollama
installation guidance opens only from an explicit user action.

### Cloud Mode

1. Select Gemini or Ollama for attribution.
2. Select Gemini, ElevenLabs, or Kokoro for speech.
3. Request only the keys needed by the selected providers.
4. Store cloud keys in the operating system credential manager.
5. Validate credentials without exposing them back to the UI.
6. Explain that Gemini plus ElevenLabs requires two independent keys.

## Configuration And Secrets

- Keep provider IDs and model IDs in TOML configuration.
- Keep API keys out of TOML, story directories, browser storage, logs, and process
  output.
- Environment variables continue to override credential-store values for CLI and
  development workflows.
- The desktop settings endpoint returns only booleans such as `credential_present`.
- Removing a credential requires an explicit action and does not delete cached
  audio.
- Changing TTS provider prompts for voice reassignment only when generation needs
  it; fully cached playback remains available.

## Packaging Plan

### Packaging Spike

Before full UI integration, prove the following on Windows x64:

1. Build a Python sidecar containing FastAPI, provider factories, Pydantic,
   soundfile dependencies needed by the engine, and optional cloud/local adapters.
2. Start it from Tauri as an `externalBin` target.
3. Complete a health request from the webview.
4. Locate the platform configuration and data directories.
5. Reach an installed Ollama service.
6. Load Kokoro native dependencies and locate downloaded assets.
7. Shut the sidecar down with the app.

Do this early because ONNX Runtime and native audio/model libraries are the highest
distribution risk.

### Installer Contents

- Tauri executable and static frontend assets.
- Packaged Teller Python sidecar and required runtime libraries.
- Licenses and third-party notices.
- No API keys.
- No Ollama executable.
- No Ollama model weights.
- No Kokoro model weights unless a later licensing and installer-size decision
  explicitly changes this.

### First-Run Downloads

- Kokoro model and voice assets remain checksum verified through the existing asset
  manager.
- Ollama models are pulled through the user's Ollama installation after consent.
- Downloads support progress, cancellation where safe, and retry.
- Partial or checksum-invalid assets are never treated as ready.

### Release Automation

- Windows x64 GitHub Actions runner.
- Python tests, Ruff, and mypy.
- Frontend lint, typecheck, tests, and production build.
- Cargo fmt, Clippy, tests, and Tauri build.
- PyInstaller sidecar build before Tauri packaging.
- Artifact smoke test on a clean Windows runner.
- Code signing before broad public distribution to reduce SmartScreen warnings.

## Testing Strategy

### Python Unit Tests

- Existing deterministic provider fakes remain the default.
- New ElevenLabs tests use `httpx.MockTransport` or an injected fake client.
- Story listing and malformed project isolation.
- API authentication and origin handling.
- Import path validation.
- Operation de-duplication, progress, cancellation, and failure cleanup.
- Cached playback without credentials.
- Mixed LLM/TTS provider setup and doctor checks.

### Python Integration Tests

- FastAPI test client with fake LLM/TTS providers.
- Import, analyze, assign, render, and fetch WAV vertical slice.
- Restart API and reload persisted stories.
- No network calls and no real credentials.

### Frontend Tests

- Add-story control remains outside the scrollable story list.
- Mobile add-story control remains sticky at the left.
- Empty, setup, analyzing, rendering, ready, and error states.
- Keyboard navigation and accessible names.
- Provider setup combinations including ElevenLabs.
- Story and cast selection.
- Audio controller queue, pause, seek, skip, lookahead, and cleanup.
- Reduced-motion behavior.

### Desktop Tests

- Rust unit tests for readiness parsing and child lifecycle.
- Tauri capability review: only required sidecar and dialog permissions.
- Development and packaged sidecar launch.
- App close terminates the child process.
- Second launch focuses the existing window.
- Windows installer smoke test.

### Manual Acceptance Matrix

- Gemini attribution plus Gemini TTS.
- Gemini attribution plus ElevenLabs TTS.
- Ollama attribution plus ElevenLabs TTS.
- Ollama attribution plus Kokoro TTS.
- Fully cached playback with all credentials removed.
- Missing Ollama.
- Missing Kokoro assets.
- Invalid Gemini key.
- Invalid or quota-exhausted ElevenLabs key.
- Large story library with the add control still immediately reachable.
- Long story rendering with responsive UI and accurate progress.
- Application restart during and after rendering.

## Implementation Phases

### Phase 0: Preserve Baseline

- Record existing worktree changes without reverting them.
- Keep the user's current `cli.py` and `test_cli.py` edits intact.
- Run the existing Python suite before feature edits.
- Retain the HTML prototypes as reference files.

Exit criteria: baseline failures, if any, are understood and unrelated changes are
untouched.

### Phase 1: ElevenLabs Provider

- Add the REST adapter.
- Add factory and credential integration.
- Refactor doctor checks by LLM and TTS provider.
- Add explicit setup/config paths.
- Add unit and CLI tests.
- Update example configuration and README.

Exit criteria: ElevenLabs returns validated WAV bytes through `TellerEngine`, all
provider tests pass, and existing Gemini/Kokoro behavior remains green.

### Phase 2: Local API

- Add desktop optional dependencies.
- Add authenticated API startup and typed schemas.
- Add story listing/import/paste/details.
- Add provider status and secrets endpoints.
- Add asynchronous operation registry.
- Add analyze/render/cast/audio endpoints.
- Add progress and API integration tests.

Exit criteria: a test client completes import through audio retrieval with fake
providers, and cached audio is retrievable without cloud credentials.

### Phase 3: Tauri And Vite Scaffold

- Create the React/TypeScript app.
- Create the Tauri 2 shell.
- Add strict capabilities and CSP.
- Implement sidecar lifecycle and backend info command.
- Complete the Windows packaging spike.

Exit criteria: a packaged development build starts the Python sidecar, renders the
React shell, completes a health request, and stops cleanly.

### Phase 4: Paper Theatre UI

- Translate the prototype into maintainable React components.
- Implement responsive desktop and mobile/tablet layouts.
- Place the add-story control above and outside the scrollable desktop list.
- Make it sticky at the left of the mobile horizontal list.
- Add setup, empty, loading, and error scenes.
- Add story and cast data binding.

Exit criteria: the UI matches the Paper Theatre direction, remains usable with a
large library, and passes accessibility/component tests.

### Phase 5: Playback And Full Integration

- Implement the Web Audio controller.
- Add segment queueing and lookahead.
- Connect import, analyze, render, progress, cast, and voice selection.
- Add provider settings for Ollama, Kokoro, Gemini, and ElevenLabs.
- Add operation cancellation and recovery.

Exit criteria: all four supported provider combinations in the acceptance matrix
complete their expected flows, using fakes in automated tests and optional manual
provider checks where credentials/runtimes are available.

### Phase 6: Windows Release Hardening

- Finalize sidecar packaging.
- Add logs and crash recovery.
- Add licenses and notices.
- Add CI build and smoke tests.
- Configure signing and updater only when release credentials exist.
- Produce the first Windows x64 installer candidate.

Exit criteria: a clean Windows machine can install, configure, render, play, close,
reopen, and uninstall Teller without a separate Python installation.

## Documentation Deliverables

- Root README desktop quick start.
- Contributor instructions for Python, Vite, and Tauri development.
- Provider configuration table.
- ElevenLabs BYOK instructions and cost warning.
- Ollama and Kokoro offline setup.
- Data, cache, model, log, and credential locations.
- Packaging and release instructions.
- Troubleshooting for WebView2, Ollama, model assets, API credentials, and audio.
- Third-party model and runtime licenses.

## Risks And Mitigations

### Native Python Packaging

Risk: ONNX Runtime, Kokoro, soundfile, and provider dependencies may not freeze
cleanly.

Mitigation: complete the packaging spike before full integration, build on the
target operating system, pin supported versions, and keep model weights external.

### Installer Size

Risk: the Python runtime and native ML libraries reduce Tauri's usual small-binary
advantage.

Mitigation: accept a moderate installer for v1, exclude model weights, avoid an
Electron runtime, and measure before introducing plugin downloads.

### Paid Duplicate Requests

Risk: retries or concurrent render actions can spend ElevenLabs credits twice.

Mitigation: preserve cache single-flight, de-duplicate active operations, avoid
automatic timeout retries, and make retry actions explicit.

### Local API Exposure

Risk: another page or process invokes the API.

Mitigation: loopback binding, per-launch bearer token, strict CORS/CSP, narrow Tauri
capabilities, and path validation.

### Playback Gaps

Risk: separate segment WAV files produce audible gaps or inaccurate seeking.

Mitigation: preload a bounded lookahead, schedule decoded buffers against the Audio
Context clock, account for intended speaker pauses, and test transitions.

### Ollama Availability

Risk: local mode appears broken when Ollama is absent, stopped, or missing a model.

Mitigation: explicit setup status, actionable diagnostics, model listing, and no
claim that Teller bundles Ollama.

### Provider Drift

Risk: cloud API models, fields, limits, or output options change.

Mitigation: isolate provider adapters, validate responses, preserve request IDs,
pin dependency ranges, and keep provider tests network-free.

## Definition Of Done

The first Windows desktop implementation is complete when all of the following are
true:

- Teller installs and starts without a system Python installation.
- The sidecar is authenticated, lifecycle-managed, and stopped on exit.
- A user can import or paste a story.
- The add-story control remains fixed and reachable with a large library.
- A user can run attribution with Gemini or Ollama.
- A user can synthesize with Gemini, Kokoro, or ElevenLabs.
- ElevenLabs audio is a validated WAV and paid work is cache protected.
- A user can inspect and override character voices.
- The player supports pause, seek, skip, volume, and resumed playback.
- Cached stories play without credentials or network access.
- API keys are stored in the operating system credential manager and never returned
  to the frontend.
- Existing CLI commands and tests continue to work.
- Python, frontend, Rust, and packaged smoke checks pass.
- The Windows installer and third-party notices are ready for an open-source
  release candidate.
