# Teller

Teller turns a plain-text story into multi-voice audio. It identifies dialogue,
keeps a persistent character cast, assigns each character a voice, generates
audio ahead of playback, and caches every result.

The first release supports:

- One-key cloud mode with Gemini for speaker attribution and exact-text TTS.
- ElevenLabs TTS support for cloud speech synthesis (`eleven_multilingual_v2` or `eleven_v4`).
- Zero-key local mode with Ollama and Kokoro ONNX.
- Persistent stories, characters, voices, segments, and WAV audio.
- A provider interface designed to power a simple web UI later.

## Requirements

- Python 3.10 through 3.13
- An audio output device
- Cloud mode: a Gemini API key
- Local mode: Ollama and a downloaded Ollama model

## Install

Clone the project, then install Teller and both provider sets:

```console
python -m pip install -e ".[all]"
```

For cloud-only or local-only installations:

```console
python -m pip install -e ".[cloud]"
python -m pip install -e ".[local]"
```

## Cloud Setup

Gemini provides structured speaker attribution and TTS using one key:

```console
teller setup --mode cloud
teller doctor
teller run path/to/story.txt
```

The setup command stores the key in the operating system credential manager.
You can instead set `GEMINI_API_KEY` before running Teller.

### ElevenLabs TTS (Cloud)

You can pair Gemini (or Ollama) for speaker attribution with ElevenLabs for voice synthesis:

```console
teller setup --mode cloud --tts elevenlabs
teller doctor
```

Or configure `ELEVENLABS_API_KEY` in your environment or credential manager. ElevenLabs BYOK (Bring Your Own Key) incurs API usage on your ElevenLabs account; Teller caches generated audio to avoid duplicate paid requests.

## Local Setup

Install [Ollama](https://ollama.com), then download a capable local model:

```console
ollama pull qwen3:8b
teller setup --mode local
teller doctor
teller run path/to/story.txt
```

Local setup downloads checksum-verified Kokoro INT8 and voice assets once
(about 142 MB). After Ollama and Kokoro models are present, normal operation
requires no internet connection and no API keys.

## Desktop Application (Paper Theatre)

Teller includes a native desktop application built with Tauri 2, React 19, TypeScript, and the Paper Theatre visual direction. It connects to the Teller Python sidecar over loopback with Bearer token authentication.

### Running Desktop in Development

1. Start the Python sidecar or run from the repo:
   ```console
   python -m teller.server --port 8000
   ```

2. Run the React frontend:
   ```console
   cd desktop
   npm install
   npm run dev
   ```

3. (Optional) Run inside the Tauri shell:
   ```console
   cd desktop
   cargo tauri dev
   ```

### Building the Windows Sidecar

Package the Python engine into a self-contained executable for the Tauri shell:

```powershell
.\scripts\build_sidecar.ps1
```

The output executable is placed at `desktop/src-tauri/binaries/teller-sidecar-x86_64-pc-windows-msvc.exe`.

## Commands

```console
teller analyze story.txt
teller render story.txt
teller play story.txt
teller run story.txt
teller cast stories/my-story-ab12cd34
teller voices list
teller voices set stories/my-story-ab12cd34 mira af_heart
```

Use `--retag` to rerun speaker attribution or `--reassign-voices` to replace
all saved voice choices. Otherwise Teller never changes an assigned voice.

You can also invoke the source checkout directly after installing dependencies:

```console
python run.py run story.txt
```

## Storage

Each imported story is stored under `stories/<title>-<source-hash>/`:

```text
story.txt
manifest.json
analysis.json
characters.json
segments.json
audio/<cache-hash>.wav
```

The audio hash includes the exact text, provider, model, voice, style, speed,
language, and cache schema version. A second render or playback makes zero TTS calls and can
play fully cached stories without provider credentials. `analysis.json` is the
atomic source of truth; the character and segment files are readable mirrors.
Speaker attribution is also reused until the source changes or `--retag` is
requested.

Configuration lives in the platform-specific user configuration directory.
Set `TELLER_CONFIG` to use another TOML file. API keys are never stored inside
story folders.

## How Attribution Works

Teller splits the source deterministically into immutable narration and quote
units. The LLM may only assign unit IDs to speakers and update the character
list; it never rewrites the story. Every response is schema-validated. Invalid
responses are retried twice, then the affected chunk safely falls back to the
Narrator voice.

## Development

```console
python -m pip install -e ".[dev]"
ruff format --check .
ruff check .
mypy src/teller
pytest
```

Provider integration tests require their corresponding API or local models;
the normal test suite uses deterministic fake providers and does not make
network calls.

## Responsible Use

Generated voices are synthetic. Disclose that fact to listeners where
appropriate, and only process stories and voices you have permission to use.

Teller is released under the MIT License. Optional models and runtimes retain
their own licenses.
