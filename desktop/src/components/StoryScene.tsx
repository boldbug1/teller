import React from "react";
import { OperationEvent, Segment, StoryDetail } from "../types";
import { AnalyzeIcon, MicIcon } from "./Icons";

interface StorySceneProps {
  story: StoryDetail | null;
  currentSegmentIndex: number;
  activeOperation: OperationEvent | null;
  onAnalyze: (force?: boolean) => void;
  onRender: () => void;
  onCancelOperation: () => void;
}

export const StoryScene: React.FC<StorySceneProps> = ({
  story,
  currentSegmentIndex,
  activeOperation,
  onAnalyze,
  onRender,
  onCancelOperation,
}) => {
  if (!story) {
    return (
      <main className="stage-center" aria-label="Main Stage">
        <div className="theatre-frame" style={{ textAlign: "center", padding: "60px 20px" }}>
          <h2 style={{ fontSize: "1.8rem", marginBottom: "12px" }}>The Stage Awaits</h2>
          <p style={{ color: "#666", maxWidth: "420px", margin: "0 auto 20px auto", lineHeight: 1.6 }}>
            Select an existing story from the library on the left, or add a new story to begin casting and performance.
          </p>
        </div>
      </main>
    );
  }

  const currentSegment: Segment | undefined = story.segments[currentSegmentIndex];
  const charMap = new Map(story.characters.map((c) => [c.id, c]));
  const speaker = currentSegment ? charMap.get(currentSegment.speaker_id) : undefined;
  const isNarrator = currentSegment?.speaker_id === "narrator";

  const isOpActive = activeOperation && (activeOperation.state === "running" || activeOperation.state === "pending");
  const progressPercent = activeOperation && activeOperation.total > 0
    ? Math.round((activeOperation.completed / activeOperation.total) * 100)
    : 0;

  return (
    <main className="stage-center" aria-label="Performance Stage">
      <div className="theatre-frame">
        {/* Proscenium Arch Backdrop Art */}
        <div className="stage-art-proscenium">
          <svg width="100%" height="100%" viewBox="0 0 600 120" preserveAspectRatio="none">
            {/* Hand-drawn curtain valance */}
            <path
              d="M0 0 C 100 60, 200 10, 300 50 C 400 10, 500 60, 600 0 L 600 20 C 500 80, 400 30, 300 70 C 200 30, 100 80, 0 20 Z"
              fill="var(--rust)"
              opacity="0.85"
            />
            <path
              d="M0 0 L 600 0 L 600 15 L 0 15 Z"
              fill="var(--gold)"
              opacity="0.9"
            />
          </svg>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="stage-title">{story.manifest.title}</h2>
            <div className="stage-subtitle">
              {story.segments.length > 0
                ? `${story.segments.length} dialogue & narration segments • ${story.characters.length} characters • ${story.rendered_count} voiced`
                : "Imported story text • Needs attribution analysis"}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn-secondary"
              onClick={() => onAnalyze(false)}
              disabled={Boolean(isOpActive)}
              title="Tag characters, dialogue, and emotion"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <AnalyzeIcon size={16} /> {story.segments.length > 0 ? "Re-Analyze" : "Analyze Story"}
            </button>
            <button
              className="btn-primary"
              onClick={onRender}
              disabled={Boolean(isOpActive || story.segments.length === 0)}
              title="Synthesize all dialogue into audio"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <MicIcon size={16} /> Render Voices
            </button>
          </div>
        </div>

        {/* Operation Progress Banner */}
        {isOpActive && (
          <div className="operation-banner" role="status">
            <span style={{ fontWeight: "bold", fontSize: "0.85rem", textTransform: "capitalize" }}>
              {activeOperation?.kind}: {activeOperation?.message_code.replace(/_/g, " ")}
            </span>
            <div className="progress-bar-container">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span style={{ fontSize: "0.85rem", fontWeight: "bold", minWidth: "45px" }}>
              {activeOperation?.completed}/{activeOperation?.total}
            </span>
            <button
              className="btn-secondary"
              style={{ padding: "3px 8px", fontSize: "0.8rem", marginLeft: "10px" }}
              onClick={onCancelOperation}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Reading Preview Box */}
        <div className="reading-unit-box">
          {currentSegment ? (
            <div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span
                  className="speaker-pill"
                  style={{
                    background: isNarrator ? "var(--paper-deep)" : "var(--gold)",
                  }}
                >
                  {speaker?.name || currentSegment.speaker_id}
                </span>
                {currentSegment.emotion && (
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.75rem",
                      fontStyle: "italic",
                      color: "#666",
                    }}
                  >
                    ({currentSegment.emotion})
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "0.7rem",
                    color: "#888",
                    marginLeft: "auto",
                  }}
                >
                  Segment {currentSegment.index + 1} of {story.segments.length}
                </span>
              </div>
              <p className="reading-text">"{currentSegment.text}"</p>
            </div>
          ) : (
            <p style={{ color: "#777", margin: 0, fontStyle: "italic" }}>
              Run "Analyze Story" to parse narration, characters, and spoken dialogue.
            </p>
          )}
        </div>
      </div>
    </main>
  );
};
