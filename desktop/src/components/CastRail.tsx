import React from "react";
import { Character } from "../types";
import { MicIcon, WarningIcon } from "./Icons";

interface CastRailProps {
  characters: Character[];
  onSelectCharacterVoice: (character: Character) => void;
  onReassignCast: () => void;
  disabled?: boolean;
}

export const CastRail: React.FC<CastRailProps> = ({
  characters,
  onSelectCharacterVoice,
  onReassignCast,
  disabled = false,
}) => {
  return (
    <aside className="cast-rail" aria-label="Cast and Voices">
      <div className="cast-rail-header">
        <h3 className="cast-rail-title">The Cast</h3>
        <button
          className="btn-secondary"
          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
          onClick={onReassignCast}
          disabled={disabled || characters.length === 0}
          title="Reassign all voices using configured TTS provider"
        >
          Reassign All
        </button>
      </div>

      <div className="cast-scroll-area">
        {characters.length === 0 ? (
          <div style={{ padding: "20px 10px", textAlign: "center", color: "#666", fontSize: "0.85rem" }}>
            No cast members detected yet.<br />Run analysis on the story.
          </div>
        ) : (
          characters.map((char) => {
            const hasVoice = Boolean(char.voice?.voice_id);
            return (
              <div key={char.id} className="character-card">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: char.id === "narrator" ? "var(--sage)" : "var(--gold)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      border: "1px solid var(--ink)",
                    }}
                  >
                    {char.name[0]?.toUpperCase()}
                  </span>
                  <span className="character-name">{char.name}</span>
                </div>

                {char.traits && char.traits.length > 0 && (
                  <div className="character-traits">
                    {char.traits.slice(0, 3).join(", ")}
                  </div>
                )}

                <button
                  className="voice-assigned-badge"
                  onClick={() => onSelectCharacterVoice(char)}
                  disabled={disabled}
                  title="Click to change character voice"
                  aria-label={`Change voice for ${char.name}, currently ${char.voice?.voice_id || "unassigned"}`}
                >
                  <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    {hasVoice ? (
                      <>
                        <MicIcon size={12} /> {char.voice?.voice_id}
                      </>
                    ) : (
                      <>
                        <WarningIcon size={12} style={{ color: "var(--rust)" }} /> Select Voice
                      </>
                    )}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "#666" }}>change</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
