from __future__ import annotations

import hashlib
import os
import urllib.request
from collections.abc import Callable
from pathlib import Path

KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
KOKORO_MODEL = "kokoro-v1.0.int8.onnx"
KOKORO_MODEL_SHA256 = "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c"
KOKORO_VOICES = "voices-v1.0.bin"
KOKORO_VOICES_SHA256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _download(
    url: str,
    destination: Path,
    expected_sha256: str,
    progress: Callable[[str], None] | None = None,
) -> None:
    if destination.exists() and file_sha256(destination) == expected_sha256:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "teller/0.1"})
    try:
        with (
            urllib.request.urlopen(request, timeout=60) as response,
            temporary.open("wb") as output,
        ):
            total = int(response.headers.get("Content-Length", "0"))
            downloaded = 0
            while block := response.read(1024 * 1024):
                output.write(block)
                digest.update(block)
                downloaded += len(block)
                if progress and total:
                    progress(f"{destination.name}: {downloaded * 100 // total}%")
        if digest.hexdigest() != expected_sha256:
            raise RuntimeError(f"Checksum verification failed for {destination.name}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def kokoro_asset_paths(assets_dir: Path) -> tuple[Path, Path]:
    directory = assets_dir.expanduser() / "kokoro"
    return directory / KOKORO_MODEL, directory / KOKORO_VOICES


def ensure_kokoro_assets(
    assets_dir: Path,
    progress: Callable[[str], None] | None = None,
) -> tuple[Path, Path]:
    model_path, voices_path = kokoro_asset_paths(assets_dir)
    _download(
        f"{KOKORO_RELEASE}/{KOKORO_MODEL}",
        model_path,
        KOKORO_MODEL_SHA256,
        progress,
    )
    _download(
        f"{KOKORO_RELEASE}/{KOKORO_VOICES}",
        voices_path,
        KOKORO_VOICES_SHA256,
        progress,
    )
    return model_path, voices_path
