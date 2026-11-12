import React from "react";
import { Character, VoiceItem } from "../types";
import { Avatar } from "./Avatar";
import { MicIcon, SlidersIcon, WarningIcon } from "./Icons";

const ELEVENLABS_DEFAULT_VOICE_NAMES: Record<string, string> = {
  JBFqnCBsd6RMkjVDRZzb: "George",
  EXAVITQu4vr4xnSDxMaL: "Sarah",
  CwhRBWXzGAHq8TQ4Fs17: "Roger",
  pqHfZKP75CvOlQylNhV4: "Bill",
  Xb7hH8MSUJpSbSDYk0k2: "Alice",
  pNInz6obpgDQGcFmaJgB: "Adam",
  "21m00Tcm4TlvDq8ikWAM": "Rachel",
  AZnzlk1XvdvUeBnXmlld: "Domi",
  ErXwobaYiN019PkySvjV: "Antoni",
  MF3mGyEYCl7XYWbNQTrH: "Elli",
  TxGEqnHWrfWFTfGW9XjX: "Josh",
  VR6AewLTigWG4xSOukaG: "Arnold",
  yoZ06aMxZJJ28mfd3POQ: "Sam",
};

interface CastRailProps {
  characters: Character[];
  voices?: VoiceItem[];
  activeSpeakerId?: string | null;
  isPlaying?: boolean;
  onSelectCharacterVoice: (character: Character) => void;
  onReassignCast: () => void;
  disabled?: boolean;
}

export const CastRail: React.FC<CastRailProps> = React.memo(function CastRail({
  characters,
  voices = [],
  activeSpeakerId = null,
  isPlaying = false,
  onSelectCharacterVoice,
  onReassignCast,
  disabled = false,
}) {
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]));

  return (
    <aside className="cast-rail" aria-label="Cast and Voices">
      <div className="cast-rail-header">
        <div>
          
          <div className="cast-title-row">
            <h2 className="cast-rail-title">Characters</h2>
            <span className="rail-count" aria-label={`${characters.length} characters`}>
              {characters.length}
            </span>
          </div>
        </div>

        <button
          className="rail-action-btn"
          onClick={onReassignCast}
          disabled={disabled || characters.length === 0}
          title="Reassign all voices automatically using configured TTS provider"
          aria-label="Reassign all voices"
        >
          <SlidersIcon size={13} />
          <span>Auto cast</span>
        </button>
      </div>

      <div className="cast-scroll-area">
        {characters.length === 0 ? (
          <div className="rail-empty-state">
            <span className="empty-portrait" aria-hidden="true" />
            <strong>No characters yet</strong>
            <span>Analyze the story to detect speakers.</span>
          </div>
        ) : (
          characters.map((char) => {
            const hasVoice = Boolean(char.voice?.voice_id);
            const isSpeaking = Boolean(isPlaying && activeSpeakerId === char.id);
            const voiceId = char.voice?.voice_id;
            const voiceObj = voiceId ? voicesById.get(voiceId) : undefined;
            const isKnownDefault = voiceId ? ELEVENLABS_DEFAULT_VOICE_NAMES[voiceId] : undefined;
            const displayVoiceName =
              isKnownDefault ||
              voiceObj?.name ||
              (voiceId
                ? voiceId.length > 12 || /[0-9a-zA-Z]{12,}/.test(voiceId)
                  ? "Assigned Voice"
                  : voiceId
                : "Select Voice");

            return (
              <div
                key={char.id}
                className={`character-card ${isSpeaking ? "is-speaking" : ""}`}
                role="region"
                aria-label={`${char.name}${isSpeaking ? " (Speaking)" : ""}`}
              >
                <div className="character-card-head">
                  <Avatar
                    name={char.name}
                    characterId={char.id}
                    traits={char.traits}
                    size={42}
                    isSpeaking={isSpeaking}
                    showEqualizer={true}
                  />

                  <div className="character-card-copy">
                    <div className="character-name-row">
                      <span className="character-name">
                        {char.name}
                      </span>
                      {isSpeaking && (
                        <span className="meter" aria-hidden="true">
                          <i /><i /><i /><i /><i /><i />
                        </span>
                      )}
                    </div>

                    {char.traits && char.traits.length > 0 && (
                      <div className="character-traits">
                        {char.traits.slice(0, 2).join(" / ")}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  className={`voice-assigned-badge ${hasVoice ? "has-voice" : "needs-voice"}`}
                  onClick={() => onSelectCharacterVoice(char)}
                  disabled={disabled}
                  title={`Voice assigned: ${displayVoiceName}. Click to reassign.`}
                  aria-label={`Change voice for ${char.name}, currently ${displayVoiceName}`}
                >
                  <span className="voice-label">
                    {hasVoice ? (
                      <>
                        <MicIcon size={13} />
                        <span className="voice-name">
                          {displayVoiceName}
                        </span>
                      </>
                    ) : (
                      <>
                        <WarningIcon size={13} />
                        <span>Select Voice</span>
                      </>
                    )}
                  </span>
                  <span className="voice-provider">
                    {char.voice?.provider || "Choose"}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
});
