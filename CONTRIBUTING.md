# Contributing to Teller

Thank you for your interest in contributing to Teller. Teller is an open-source tool that turns text into multi-character audiobooks and radio plays. This document provides guidelines and instructions for contributing to the codebase.

---

## Code of Conduct

Contributors are expected to maintain a welcoming, respectful, and professional environment. Focus on constructive feedback, technical excellence, and user-centric design.

---

## Technical Stack & Architecture

Teller is structured as a dual-runtime application:

1. **Desktop Application (`desktop/`)**:
   - Built with **Tauri 2**, **React 19**, and **TypeScript**.
   - Handles the visual interface, story library view, dialogue feed, audio transport, and window controls.
   - Communicates with the backend over HTTP and WebSockets via a local sidecar process.

2. **Core Engine & Sidecar (`src/teller/`)**:
   - Written in **Python 3.10+**.
   - Exposes a **FastAPI** REST and WebSocket server (`src/teller/server.py`).
   - Implements dialogue attribution (`tagger.py`), voice management (`characters.py`), audio generation (`pipeline.py`), and audio concatenation (`audio_export.py`).
   - Packaged as a standalone single-file binary for desktop distribution using PyInstaller (`scripts/build_sidecar.ps1`).

---

## Development Environment Setup

### Prerequisites

- **Python**: 3.10 through 3.13
- **Node.js**: 18.x or newer
- **Rust**: Latest stable toolchain with `cargo`
- **Git**

### Step-by-Step Setup

1. **Fork and Clone the Repository**:

   ```bash
   git clone https://github.com/boldbug1/teller.git
   cd teller
   ```

2. **Setup the Python Environment**:

   ```bash
   # Create and activate virtual environment
   python -m venv .venv

   # Windows
   .venv\Scripts\activate

   # Linux / macOS
   source .venv/bin/activate

   # Install dependencies in editable mode
   pip install -e ".[all]"
   pip install pytest pytest-asyncio ruff mypy
   ```

3. **Setup the Desktop Frontend**:

   ```bash
   cd desktop
   npm install
   ```

4. **Run the Application in Development Mode**:

   From the repository root on Windows:
   ```cmd
   start.bat
   ```

   Or run frontend and backend separately:

   **Terminal 1 (Backend Server)**:
   ```bash
   python -m teller.server --port 8765
   ```

   **Terminal 2 (Desktop App)**:
   ```bash
   cd desktop
   npm run tauri dev
   ```

---

## Development Standards & Conventions

### Python Guidelines

- **Type Annotations**: All public functions and class methods must have complete type hints. Avoid `Any` where a specific type or generic can be used.
- **Async Programming**: Network operations, LLM queries, and TTS synthesis calls must be asynchronous using `async`/`await`. Do not block the asyncio event loop with CPU-intensive operations; use `asyncio.to_thread` when calling synchronous libraries.
- **Error Handling**: Fail visibly and informatively. Catch specific exceptions rather than bare `except Exception:`. Never silently discard errors or replace them with mock data without explicit fallback logging.
- **Code Formatting**: Code must conform to PEP 8 standards. Use `ruff check` and `ruff format` before committing.

### Frontend Guidelines

- **TypeScript Strictness**: Keep types strict. Define explicit interfaces in `desktop/src/types.ts`.
- **Component Architecture**: Keep components focused. Defer state mutations to custom hooks or API handlers.
- **Styling**: All styles reside in `desktop/src/styles/paper-theatre.css` using CSS custom properties. Do not introduce CSS-in-JS or utility class frameworks like Tailwind. Ensure consistent padding, legible contrast, and responsive sizing.
- **Accessibility**: Provide clear `aria-label`, `title`, and keyboard support (`tabIndex`, `onKeyDown`) for interactive elements.

### Architecture Invariants

- **Original Text Preservation**: Teller never rewrites, summarizes, or deletes words from source stories. Dialogue parsing splits text into segments, but verbatim reconstruction must always be possible.
- **Deterministic Audio Caching**: Audio synthesis must always check the cache before making external API requests. The cache key includes text, voice ID, emotion, speed, language, provider, and model.
- **Key Security**: API keys must never be committed to version control or written to story directories. Store keys in the OS credential manager via `teller.secrets`.

---

## Running Tests

### Backend Unit Tests

Run test suites using `pytest`:

```bash
# Run all tests
pytest

# Run specific provider tests
pytest tests/test_api.py tests/test_cache.py
```

### Frontend Tests

From the `desktop/` directory:

```bash
cd desktop
npm test
```

---

## Building Binaries

### Rebuilding the Python Sidecar

When modifying files in `src/teller/`, rebuild the sidecar binary:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build_sidecar.ps1
```

The output binary is written to `desktop/src-tauri/binaries/teller-sidecar-x86_64-pc-windows-msvc.exe`.

### Packaging the Desktop App

From the `desktop/` directory:

```bash
cd desktop
npm run build
npm run tauri build
```

The compiled Windows executable is generated at `desktop/src-tauri/target/release/teller-desktop.exe`.

---

## Submitting Pull Requests

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Keep commits concise and meaningful following the Conventional Commits specification (e.g. `feat(tagger): ...`, `fix(ui): ...`, `docs: ...`).
3. Ensure all tests pass and no linter warnings remain.
4. Verify that the desktop app launches and functions properly.
5. Submit a pull request to `main` with a clear explanation of changes, rationale, and screenshots where applicable.
