import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteModal } from "../DeleteModal";
import { Transport } from "../Transport";
import { VoicePickerModal } from "../VoicePickerModal";

describe("polished interactions", () => {
  it("provides a seekable playback timeline", () => {
    const onSeek = vi.fn();
    render(
      <Transport
        isPlaying={false}
        currentTime={20}
        totalDuration={100}
        volume={0.8}
        onPlay={() => {}}
        onPause={() => {}}
        onPrev={() => {}}
        onNext={() => {}}
        onSeek={onSeek}
        onVolumeChange={() => {}}
      />
    );

    fireEvent.change(screen.getByRole("slider", { name: "Story progress" }), {
      target: { value: "42" },
    });
    expect(onSeek).toHaveBeenCalledWith(42);
  });

  it("waits for voice assignment before closing the picker", async () => {
    let finishAssignment: (() => void) | undefined;
    const onAssignVoice = vi.fn(() => new Promise<void>((resolve) => {
      finishAssignment = resolve;
    }));
    const onClose = vi.fn();

    render(
      <VoicePickerModal
        isOpen
        character={{
          id: "narrator",
          name: "Narrator",
          aliases: [],
          traits: ["warm"],
          last_seen_chunk: 0,
        }}
        voices={[{ id: "voice-1", name: "Warm Voice", traits: ["calm"] }]}
        onClose={onClose}
        onAssignVoice={onAssignVoice}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Warm Voice/i }));
    expect(onClose).not.toHaveBeenCalled();

    finishAssignment?.();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes dialogs with Escape", () => {
    const onClose = vi.fn();
    render(
      <DeleteModal
        isOpen
        storyTitle="The Monkey's Paw"
        onClose={onClose}
        onConfirm={() => {}}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
