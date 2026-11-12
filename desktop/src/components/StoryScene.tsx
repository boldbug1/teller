import React, { createContext, memo, useContext, useEffect, useMemo, useRef } from "react";
import { Character, OperationEvent, Segment, StoryDetail } from "../types";
import {
  DownloadIcon,
  EqualizerBars,
  MicIcon,
  SparklesIcon,
  WarningIcon,
} from "./Icons";

interface StorySceneProps {
  story: StoryDetail | null;
  currentSegmentIndex: number;
  segmentTime?: number;
  segmentDuration?: number;
  isPlaying?: boolean;
  isLoading?: boolean;
  activeOperation: OperationEvent | null;
  operationError?: string | null;
  onDismissError?: () => void;
  onOpenSettings?: () => void;
  onAnalyze: (force?: boolean) => void;
  onRender: () => void;
  onCancelOperation: () => void;
  onDownload?: () => void;
  isDownloading?: boolean;
  onSeekSegment?: (index: number) => void;
  onAddStory?: () => void;
}

function renderDialogueWords(
  text: string,
  isActive: boolean,
  isPlaying: boolean,
  segmentTime = 0,
  segmentDuration = 0
) {
  if (!isActive || !isPlaying || segmentDuration <= 0) {
    return <span className="dialogue-text-static">{text}</span>;
  }

  const tokens = text.split(/(\s+)/);
  const totalChars = tokens.reduce((total, token) => total + (token.trim() ? token.length : 0), 0);
  if (totalChars === 0) return <span>{text}</span>;

  const currentTargetChar = Math.min(0.999, Math.max(0, segmentTime / segmentDuration)) * totalChars;
  let accumulatedChars = 0;

  return (
    <span className="dialogue-karaoke-stream">
      {tokens.map((token, index) => {
        if (!token.trim()) return <span key={index}>{token}</span>;

        const wordStart = accumulatedChars;
        const wordEnd = accumulatedChars + token.length;
        accumulatedChars = wordEnd;
        const className = currentTargetChar >= wordEnd
          ? "karaoke-word word-spoken"
          : currentTargetChar >= wordStart
            ? "karaoke-word word-speaking-glow"
            : "karaoke-word word-upcoming";

        return <span key={index} className={className}>{token}</span>;
      })}
    </span>
  );
}

interface SegmentLineProps {
  segment: Segment;
  speaker?: Character;
  isActive: boolean;
  isPlaying: boolean;
  onSeekSegment?: (index: number) => void;
}

const PlaybackTimingContext = createContext({ segmentTime: 0, segmentDuration: 0, isPlaying: false });

function ActiveDialogueWords({ text }: { text: string }) {
  const timing = useContext(PlaybackTimingContext);
  return renderDialogueWords(
    text,
    true,
    timing.isPlaying,
    timing.segmentTime,
    timing.segmentDuration
  );
}

const SegmentLine = memo(function SegmentLine({
  segment,
  speaker,
  isActive,
  isPlaying,
  onSeekSegment,
}: SegmentLineProps) {
  const speakerName = speaker?.name || segment.speaker_id;
  const seekToLine = () => onSeekSegment?.(segment.index);

  return (
    <article
      className={`floating-speech-card script-line ${isActive ? "is-active-card" : ""}`}
      aria-current={isActive ? "true" : undefined}
      aria-label={`Line ${segment.index + 1}, ${speakerName}`}
      tabIndex={onSeekSegment ? 0 : undefined}
      onClick={seekToLine}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          seekToLine();
        }
      }}
      title={`Jump to line ${segment.index + 1}`}
    >
      <div className="script-line-gutter" aria-hidden="true">
        <span>{String(segment.index + 1).padStart(2, "0")}</span>
        <i />
      </div>
      <div className="script-line-body">
        <div className="speech-meta-row">
          <span className="speech-speaker-label">{speakerName}</span>
          {segment.emotion ? <span className="speech-emotion-pill">{segment.emotion}</span> : null}
          {isActive && isPlaying ? <EqualizerBars active color="var(--rust)" /> : null}
        </div>
        <p className="speech-paragraph-content">
          {isActive
            ? <ActiveDialogueWords text={segment.text} />
            : <span className="dialogue-text-static">{segment.text}</span>}
        </p>
      </div>
    </article>
  );
});

function StageArtwork({ state = "idle" }: { state?: "idle" | "working" | "ready" }) {
  return (
    <div className={`stage-art-proscenium scene-${state}`} aria-hidden="true">
      <div className="stage-sun" />
      <div className="stage-bird bird-a" />
      <div className="stage-bird bird-b" />
      <div className="stage-hill hill-one" />
      <div className="stage-hill hill-two" />
      <div className="stage-curtain curtain-left" />
      <div className="stage-curtain curtain-right" />
    </div>
  );
}

export const StoryScene: React.FC<StorySceneProps> = ({
  story,
  currentSegmentIndex,
  segmentTime = 0,
  segmentDuration = 0,
  isPlaying = false,
  isLoading: _isLoading = false,
  activeOperation,
  operationError,
  onDismissError,
  onOpenSettings,
  onAnalyze,
  onRender,
  onCancelOperation,
  onDownload,
  isDownloading = false,
  onSeekSegment,
  onAddStory,
}) => {
  const streamRef = useRef<HTMLDivElement>(null);
  const characterById = useMemo(
    () => new Map(story?.characters.map((character) => [character.id, character]) || []),
    [story?.characters]
  );
  const segmentLines = useMemo(
    () => (story?.segments || []).map((segment) => {
      const isActive = segment.index === currentSegmentIndex;
      return (
        <SegmentLine
          key={segment.index}
          segment={segment}
          speaker={characterById.get(segment.speaker_id)}
          isActive={isActive}
          isPlaying={isActive && isPlaying}
          onSeekSegment={onSeekSegment}
        />
      );
    }),
    [characterById, currentSegmentIndex, isPlaying, onSeekSegment, story?.segments]
  );

  useEffect(() => {
    const activeLine = streamRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    if (!activeLine || typeof activeLine.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    activeLine.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }, [currentSegmentIndex]);

  if (!story) {
    return (
      <main className="stage-center" aria-label="Main Stage">
        <article className="theatre-frame empty-stage">
          <button
            type="button"
            className="giant-import-zone"
            onClick={onAddStory}
            aria-label="Import story"
            title="Import or create a story"
          >
            <span className="giant-plus-icon">+</span>
            <span className="giant-import-label">Import Story</span>
            <span className="giant-import-subtext">
              Click to choose a story file or paste text
              <span className="giant-import-formats">Supports .txt, .md, .pdf, .docx</span>
            </span>
          </button>
          {operationError ? (
            <div className="empty-stage-error" role="alert">
              <WarningIcon size={17} />
              <span>{operationError}</span>
              {onOpenSettings ? (
                <button type="button" className="text-action-btn" onClick={onOpenSettings}>Open Settings</button>
              ) : null}
              {onDismissError ? (
                <button type="button" className="text-action-btn" onClick={onDismissError}>Dismiss</button>
              ) : null}
            </div>
          ) : null}
        </article>
      </main>
    );
  }

  const isOpActive = Boolean(
    activeOperation && (activeOperation.state === "running" || activeOperation.state === "pending")
  );
  const progressPercent = activeOperation && activeOperation.total > 0
    ? Math.round((activeOperation.completed / activeOperation.total) * 100)
    : 0;
  const operationLabel = activeOperation?.kind === "analyze"
    ? "Analyzing story"
    : activeOperation?.kind === "render"
      ? "Generating audio"
      : "Processing";

  return (
    <main className="stage-center" aria-label="Performance Stage">
      <article className="theatre-frame story-page">
        <StageArtwork state={isOpActive ? "working" : story.rendered_count > 0 ? "ready" : "idle"} />

        <div className="stage-header-toolbar">
          <div className="stage-title-block">
            <h2 className="stage-title">{story.manifest.title}</h2>
            <div className="stage-subtitle">
              <span>{story.segments.length} lines</span>
              <i aria-hidden="true" />
              <span>{story.characters.length} characters</span>
              <i aria-hidden="true" />
              <span className={story.rendered_count > 0 ? "is-ready" : ""}>
                {story.rendered_count}/{story.total_count || story.segments.length} generated
              </span>
            </div>
          </div>

          <div className="stage-actions-group" aria-label="Story actions">
            <button
              type="button"
              className="icon-action-btn"
              onClick={() => onAnalyze(false)}
              disabled={isOpActive}
              title="Detect speakers, dialogue, and emotion"
            >
              <SparklesIcon size={15} />
              <span>{story.segments.length > 0 ? "Re-Analyze" : "Analyze"}</span>
            </button>
            <button
              type="button"
              className="icon-action-btn primary"
              onClick={onRender}
              disabled={isOpActive || story.segments.length === 0}
              title="Synthesize the story with its assigned voices"
            >
              <MicIcon size={15} />
              <span>{activeOperation?.kind === "render" && isOpActive ? "Recording..." : "Render Voices"}</span>
            </button>
            {onDownload ? (
              <button
                type="button"
                className="icon-action-btn icon-only"
                onClick={onDownload}
                disabled={isOpActive || story.rendered_count === 0 || isDownloading}
                title={story.rendered_count > 0 ? "Export story audio" : "Render voices before exporting"}
                aria-label="Download Audio"
              >
                <DownloadIcon size={16} />
                <span className="sr-only">Download Audio</span>
              </button>
            ) : null}
          </div>
        </div>

        {isOpActive ? (
          <div className="operation-banner" role="status" aria-live="polite">
            <span className="spinner-indicator" aria-hidden="true" />
            <div className="operation-copy">
              <strong>{operationLabel}</strong>
              <span>{activeOperation?.message_code?.replace(/_/g, " ") || "Working..."}</span>
            </div>
            <div
              className="progress-bar-container"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={activeOperation?.total || 1}
              aria-valuenow={activeOperation?.completed || 0}
            >
              <div className="progress-fill" style={{ width: `${progressPercent || 8}%` }} />
            </div>
            <strong className="operation-count">
              {activeOperation?.total ? `${activeOperation.completed}/${activeOperation.total}` : "..."}
            </strong>
            <button type="button" className="text-action-btn" onClick={onCancelOperation}>Cancel</button>
          </div>
        ) : null}

        {operationError ? (
          <div className="operation-error-banner" role="alert">
            <WarningIcon size={18} />
            <span>{operationError}</span>
            <div className="banner-actions">
              {onOpenSettings ? (
                <button type="button" className="text-action-btn" onClick={onOpenSettings}>Open Settings</button>
              ) : null}
              {onDismissError ? (
                <button type="button" className="text-action-btn" onClick={onDismissError}>Dismiss</button>
              ) : null}
            </div>
          </div>
        ) : null}

        {story.segments.length > 0 ? (
          <section className="script-panel" aria-label="Story script">
            <div className="script-panel-heading">
              <div>
                <span className="section-kicker">Script</span>
                
              </div>
              <span>Line {Math.min(currentSegmentIndex + 1, story.segments.length)} of {story.segments.length}</span>
            </div>
            <PlaybackTimingContext.Provider value={{ segmentTime, segmentDuration, isPlaying }}>
              <div className="floating-story-stream" ref={streamRef} role="feed" aria-label="Story dialogue stream">
                {segmentLines}
              </div>
            </PlaybackTimingContext.Provider>
          </section>
        ) : (
          <section className="manuscript-preview">
            <h3>Ready to Analyze</h3>
            <p className="preview-guide-text">
              Detect the characters, spoken dialogue, and narrative emotions.
            </p>
            <div className="manuscript-excerpt">
              {story.text.slice(0, 520)}{story.text.length > 520 ? "..." : ""}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onAnalyze(false)}
              disabled={isOpActive}
            >
              <SparklesIcon size={16} /> Analyze Story
            </button>
          </section>
        )}
      </article>
    </main>
  );
};
