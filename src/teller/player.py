from __future__ import annotations

import asyncio
import io


class SoundDevicePlayer:
    @staticmethod
    def _play(wav_audio: bytes) -> None:
        import sounddevice as sound_device
        import soundfile as sound_file

        with sound_file.SoundFile(io.BytesIO(wav_audio)) as audio_file:
            samples = audio_file.read(dtype="float32", always_2d=True)
            sound_device.play(samples, audio_file.samplerate)
            sound_device.wait()

    async def play(self, wav_audio: bytes) -> None:
        await asyncio.to_thread(self._play, wav_audio)


class NullPlayer:
    def __init__(self) -> None:
        self.played: list[bytes] = []

    async def play(self, wav_audio: bytes) -> None:
        self.played.append(wav_audio)
