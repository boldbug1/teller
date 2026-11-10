import React from "react";
import { DownloadIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon } from "./Icons";

interface TransportProps {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  volume: number;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVolumeChange: (vol: number) => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  disabled?: boolean;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
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
  onVolumeChange,
  onDownload,
  downloadDisabled = false,
  disabled = false,
}) => {
  const progressRatio = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;

  return (
    <footer className="transport-bar" aria-label="Playback Transport">
      <div className="transport-controls">
        <button
          className="transport-btn"
          onClick={onPrev}
          disabled={disabled}
          title="Previous segment"
          aria-label="Previous segment"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <PrevIcon size={14} />
        </button>

        <button
          className="play-button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} style={{ marginLeft: "2px" }} />}
        </button>

        <button
          className="transport-btn"
          onClick={onNext}
          disabled={disabled}
          title="Next segment"
          aria-label="Next segment"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <NextIcon size={14} />
        </button>
      </div>

      <div className="scrubber-section">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontFamily: "var(--font-sans)", color: "#555" }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
        <div className="scrubber-track">
          <div className="scrubber-progress" style={{ width: `${progressRatio * 100}%` }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <VolumeIcon size={16} style={{ color: "#555" }} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            style={{ width: "80px", cursor: "pointer", margin: 0 }}
            aria-label="Volume slider"
          />
        </div>

        {onDownload && (
          <button
            className="transport-btn"
            onClick={onDownload}
            disabled={disabled || downloadDisabled}
            title={downloadDisabled ? "Render voices to download audio" : "Download full story audio (WAV)"}
            aria-label="Download full story audio"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <DownloadIcon size={15} />
          </button>
        )}
      </div>
    </footer>
  );
};
