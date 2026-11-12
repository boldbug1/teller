import React from "react";
import { getCharacterStyle } from "../utils/avatars";
import { EqualizerBars } from "./Icons";

interface AvatarProps {
  name: string;
  characterId?: string;
  traits?: string[];
  size?: number;
  isSpeaking?: boolean;
  showEqualizer?: boolean;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = React.memo(function Avatar({
  name,
  characterId,
  traits = [],
  size = 40,
  isSpeaking = false,
  showEqualizer = false,
  className = "",
}) {
  const style = getCharacterStyle(name, characterId, traits);

  return (
    <div
      className={`char-avatar-wrapper ${isSpeaking ? "is-speaking" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        ["--avatar-glow" as string]: style.glowColor,
        ["--avatar-primary" as string]: style.primaryColor,
      }}
      title={`${name}${isSpeaking ? " (Speaking)" : ""}`}
    >
      <div
        className="char-avatar-ring"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
        }}
      >
        <div
          className="char-avatar-fallback"
          style={{
            background: style.gradient,
            fontSize: Math.max(10, Math.round(size * 0.3)),
          }}
          aria-hidden="true"
        >
          {style.initials}
        </div>
      </div>

      {isSpeaking && showEqualizer && (
        <div className="char-avatar-eq">
          <EqualizerBars active={true} color="#fbbf24" />
        </div>
      )}
    </div>
  );
});
