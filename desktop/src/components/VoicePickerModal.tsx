import React, { useState } from "react";
import { Character, VoiceItem } from "../types";
import { CheckIcon } from "./Icons";

interface VoicePickerModalProps {
  isOpen: boolean;
  character: Character | null;
  voices: VoiceItem[];
  onClose: () => void;
  onAssignVoice: (characterId: string, voiceId: string) => void;
}

export const VoicePickerModal: React.FC<VoicePickerModalProps> = ({
  isOpen,
  character,
  voices,
  onClose,
  onAssignVoice,
}) => {
  const [filter, setFilter] = useState("");

  if (!isOpen || !character) return null;

  const filteredVoices = voices.filter((v) => {
    const q = filter.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.id.toLowerCase().includes(q) ||
      (v.gender && v.gender.toLowerCase().includes(q)) ||
      v.traits.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-modal-title">
      <div className="modal-dialog">
        <h2 id="voice-modal-title" className="modal-title">
          Assign Voice for {character.name}
        </h2>

        <input
          type="text"
          placeholder="Filter voices by name, gender, traits..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />

        <div style={{ maxHeight: "320px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
          {filteredVoices.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
              No voices match your filter.
            </div>
          ) : (
            filteredVoices.map((voice) => {
              const isSelected = character.voice?.voice_id === voice.id;
              return (
                <div
                  key={voice.id}
                  onClick={() => {
                    onAssignVoice(character.id, voice.id);
                    onClose();
                  }}
                  style={{
                    padding: "10px 14px",
                    border: "1.5px solid var(--ink)",
                    borderRadius: "3px",
                    background: isSelected ? "var(--gold)" : "var(--paper-card)",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                      {voice.name}
                      {isSelected && <CheckIcon size={14} style={{ color: "var(--ink)" }} />}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#555" }}>
                      {voice.gender ? `${voice.gender} • ` : ""}
                      {voice.traits.join(", ")}
                    </div>
                  </div>
                  <span style={{ fontSize: "0.8rem", color: "#444", fontFamily: "var(--font-sans)" }}>
                    {voice.id}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
