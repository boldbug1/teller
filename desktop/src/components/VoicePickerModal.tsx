import React, { useDeferredValue, useEffect, useState } from "react";
import { Character, VoiceItem } from "../types";
import { Avatar } from "./Avatar";
import { CheckIcon, CloseIcon, MicIcon } from "./Icons";
import { useDialog } from "./useDialog";

interface VoicePickerModalProps {
  isOpen: boolean;
  character: Character | null;
  voices: VoiceItem[];
  onClose: () => void;
  onAssignVoice: (characterId: string, voiceId: string) => void | Promise<void>;
}

export const VoicePickerModal: React.FC<VoicePickerModalProps> = ({
  isOpen,
  character,
  voices,
  onClose,
  onAssignVoice,
}) => {
  const [filter, setFilter] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deferredFilter = useDeferredValue(filter);
  const dialogRef = useDialog(isOpen, onClose, !assigningId);

  useEffect(() => {
    if (!isOpen) return;
    setFilter("");
    setAssigningId(null);
    setError(null);
  }, [character?.id, isOpen]);

  if (!isOpen || !character) return null;

  const query = deferredFilter.trim().toLowerCase();
  const filteredVoices = query
    ? voices.filter((voice) => {
        const searchable = [voice.name, voice.id, voice.gender, voice.age, voice.language, ...voice.traits]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      })
    : voices;

  const assignVoice = async (voiceId: string) => {
    setAssigningId(voiceId);
    setError(null);
    try {
      await onAssignVoice(character.id, voiceId);
      onClose();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "The voice could not be assigned.");
      setAssigningId(null);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-dialog voice-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-modal-title"
        tabIndex={-1}
      >
        <div className="modal-header voice-picker-header">
          <Avatar name={character.name} characterId={character.id} traits={character.traits} size={48} />
          <div className="modal-header-copy">
            <span className="section-kicker">Casting desk</span>
            <h2 id="voice-modal-title" className="modal-title">Voice for {character.name}</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={Boolean(assigningId)} aria-label="Close voice picker">
            <CloseIcon size={15} />
          </button>
        </div>

        <label className="sr-only" htmlFor="voice-search">Search available voices</label>
        <div className="voice-search-wrap">
          <MicIcon size={16} />
          <input
            id="voice-search"
            type="search"
            placeholder="Search name, language, or character..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            data-autofocus
          />
          <span>{filteredVoices.length} voices</span>
        </div>

        {error ? <div className="form-alert error" role="alert">{error}</div> : null}

        <div className="voice-option-list" aria-label="Available voices">
          {filteredVoices.length === 0 ? (
            <div className="modal-empty-state">No voices match "{deferredFilter}".</div>
          ) : (
            filteredVoices.map((voice) => {
              const isSelected = character.voice?.voice_id === voice.id;
              const isAssigning = assigningId === voice.id;
              const details = [voice.gender, voice.age, voice.language, ...voice.traits.slice(0, 2)]
                .filter(Boolean)
                .join(" / ");
              return (
                <button
                  type="button"
                  key={voice.id}
                  className={`voice-option ${isSelected ? "is-selected" : ""}`}
                  aria-pressed={isSelected}
                  disabled={Boolean(assigningId)}
                  onClick={() => void assignVoice(voice.id)}
                >
                  <span className="voice-option-mark" aria-hidden="true">
                    {isSelected ? <CheckIcon size={15} /> : voice.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="voice-option-copy">
                    <strong>{voice.name}</strong>
                    <span>{details || "General purpose voice"}</span>
                  </span>
                  <span className="voice-option-state">
                    {isAssigning ? "Assigning..." : isSelected ? "Current" : "Choose"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={Boolean(assigningId)}>Close</button>
        </div>
      </div>
    </div>
  );
};
