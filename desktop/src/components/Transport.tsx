import React, { useRef, useState } from "react";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon, VolumeMuteIcon } from "./Icons";

interface TransportProps {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  volume: number;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  disabled?: boolean;
  currentSpeakerName?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const Transport: React.FC<TransportProps> = ({
  isPlaying,
  currentTime,
  totalDuration,
  volume,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
  disabled = false,
  currentSpeakerName,
}) => {
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const isDragging = useRef(false);
  const duration = Math.max(totalDuration, 0.1);
  const displayedTime = Math.min(draftTime ?? currentTime, duration);
  const progressRatio = totalDuration > 0 ? Math.min(1, displayedTime / totalDuration) : 0;

  return (
    <footer className="transport-bar" aria-label="Playback transport">
      <div className="media-capsule-dock" role="toolbar" aria-label="Playback controls">
        <button
          type="button"
          className="capsule-btn"
          onClick={onPrev}
          disabled={disabled}
          title="Previous dialogue line"
          aria-label="Previous segment"
        >
          <PrevIcon size={14} />
        </button>
        <button
          type="button"
          className="capsule-btn play-btn"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          title={isPlaying ? "Pause playback" : "Play story"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button
          type="button"
          className="capsule-btn"
          onClick={onNext}
          disabled={disabled}
          title="Next dialogue line"
          aria-label="Next segment"
        >
          <NextIcon size={14} />
        </button>
      </div>

      <div className="scrubber-section">
        <div className="scrubber-time-row">
          <span>{formatTime(displayedTime)}</span>
          {currentSpeakerName ? (
            <span className="scrubber-speaker-tag">{currentSpeakerName}</span>
          ) : (
            <span className="scrubber-speaker-tag is-idle">Ready for curtain</span>
          )}
          <span>{formatTime(totalDuration)}</span>
        </div>
        <input
          className="transport-scrubber"
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={displayedTime}
          disabled={disabled || totalDuration <= 0}
          aria-label="Story progress"
          style={{ "--playback-progress": `${progressRatio * 100}%` } as React.CSSProperties}
          onPointerDown={(event) => {
            isDragging.current = true;
            setDraftTime(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            const nextTime = Number(event.currentTarget.value);
            if (isDragging.current) setDraftTime(nextTime);
            else onSeek(nextTime);
          }}
          onPointerUp={(event) => {
            isDragging.current = false;
            setDraftTime(null);
            onSeek(Number(event.currentTarget.value));
          }}
          onPointerCancel={() => {
            isDragging.current = false;
            setDraftTime(null);
          }}
        />
      </div>

      <div className="volume-dock">
        <button
          type="button"
          className="transport-icon-btn"
          onClick={() => onVolumeChange(volume > 0 ? 0 : 1)}
          title={volume === 0 ? "Unmute" : "Mute"}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? <VolumeMuteIcon size={15} /> : <VolumeIcon size={15} />}
        </button>
        <input
          className="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          aria-label="Volume"
        />
      </div>
    </footer>
  );
};
