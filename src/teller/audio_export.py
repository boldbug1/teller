from __future__ import annotations

import io
import re
import wave
from pathlib import Path
from typing import Sequence

from teller.cache import AudioCache, audio_cache_key
from teller.config import AppConfig
from teller.models import Character, Segment, StoryProject


def slugify_filename(title: str, default: str = "story", ext: str = "wav") -> str:
    """Turn a story title into a safe, clean filename for download."""
    clean = re.sub(r"[^\w\s-]", "", title).strip()
    clean = re.sub(r"[-\s]+", "_", clean).strip("_")
    if not clean:
        clean = default
    ext_clean = ext.lstrip(".")
    return f"{clean}.{ext_clean}"


def stitch_story_audio(
    project: StoryProject,
    segments: Sequence[Segment],
    characters: Sequence[Character],
    config: AppConfig,
    speaker_pause_ms: int = 250,
    same_speaker_pause_ms: int = 120,
) -> tuple[bytes, float, int]:
    """
    Concatenate all rendered segment audio files for a story into a single master WAV file.
    
    Inserts natural silence between segments:
    - speaker_pause_ms between different speakers
    - same_speaker_pause_ms between segments from the same speaker
    
    Returns:
        (wav_bytes, duration_seconds, rendered_segment_count)
        
    Raises:
        ValueError if no rendered segment audio is found.
    """
    by_id = {char.id: char for char in characters}
    cache = AudioCache(project.path / "audio")

    cached_segments: list[tuple[Segment, bytes]] = []
    for segment in segments:
        char = by_id.get(segment.speaker_id)
        if not char or not char.voice:
            continue
        key = audio_cache_key(
            provider=char.voice.provider,
            model=char.voice.model,
            voice_id=char.voice.voice_id,
            text=segment.text.strip(),
            style=segment.emotion,
            speed=config.tts.speed,
            language=config.tts.language,
        )
        audio = cache.get(key)
        if audio is not None:
            cached_segments.append((segment, audio))

    if not cached_segments:
        raise ValueError("No rendered audio segments found for this story. Please render voices first.")

    # Read audio parameters from the first segment
    first_data = cached_segments[0][1]
    with wave.open(io.BytesIO(first_data), "rb") as first_wave:
        master_params = first_wave.getparams()

    nchannels = master_params.nchannels
    sampwidth = master_params.sampwidth
    framerate = master_params.framerate

    speaker_pause_frames = int(framerate * (speaker_pause_ms / 1000.0))
    same_pause_frames = int(framerate * (same_speaker_pause_ms / 1000.0))
    speaker_silence = b"\x00" * (speaker_pause_frames * nchannels * sampwidth)
    same_silence = b"\x00" * (same_pause_frames * nchannels * sampwidth)

    all_frames: list[bytes] = []
    prev_speaker_id: str | None = None
    stitched_count = 0

    for segment, audio_data in cached_segments:
        try:
            with wave.open(io.BytesIO(audio_data), "rb") as seg_wave:
                # Check if params match master
                if (
                    seg_wave.getnchannels() == nchannels
                    and seg_wave.getsampwidth() == sampwidth
                    and seg_wave.getframerate() == framerate
                ):
                    frames = seg_wave.readframes(seg_wave.getnframes())
                else:
                    # Parameter mismatch: attempt resample / conform via soundfile
                    frames = _conform_audio_frames(
                        audio_data, target_channels=nchannels, target_width=sampwidth, target_rate=framerate
                    )
        except Exception:
            # If wave.open fails, try soundfile fallback
            frames = _conform_audio_frames(
                audio_data, target_channels=nchannels, target_width=sampwidth, target_rate=framerate
            )

        if not frames:
            continue

        # Insert appropriate pause before this segment
        if prev_speaker_id is not None:
            if segment.speaker_id != prev_speaker_id:
                all_frames.append(speaker_silence)
            else:
                all_frames.append(same_silence)

        all_frames.append(frames)
        prev_speaker_id = segment.speaker_id
        stitched_count += 1

    combined_data = b"".join(all_frames)
    total_frames = len(combined_data) // (nchannels * sampwidth)
    duration_seconds = total_frames / float(framerate) if framerate > 0 else 0.0

    out_buf = io.BytesIO()
    with wave.open(out_buf, "wb") as out_wave:
        out_wave.setnchannels(nchannels)
        out_wave.setsampwidth(sampwidth)
        out_wave.setframerate(framerate)
        out_wave.writeframes(combined_data)

    return out_buf.getvalue(), duration_seconds, stitched_count


def _conform_audio_frames(
    raw_data: bytes,
    target_channels: int,
    target_width: int,
    target_rate: int,
) -> bytes:
    """Conform audio data with mismatched parameters to the target PCM format using soundfile."""
    try:
        import numpy as np
        import soundfile as sf

        with io.BytesIO(raw_data) as in_buf:
            data, sr = sf.read(in_buf, dtype="int16")

        # Convert channels if needed
        if target_channels == 1 and data.ndim > 1:
            data = data.mean(axis=1).astype(np.int16)
        elif target_channels == 2 and data.ndim == 1:
            data = np.column_stack((data, data))

        # Output raw bytes
        return data.tobytes()
    except Exception:
        return b""
