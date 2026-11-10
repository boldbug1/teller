import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StoryScene } from "../StoryScene";
import { StoryDetail } from "../../types";

const mockStory: StoryDetail = {
  manifest: {
    story_id: "test-story",
    title: "The Monkey's Paw",
    source_name: "story.txt",
    source_sha256: "abc123",
    schema_version: 1,
    tagger_revision: 1,
    created_at: "2026-11-10T00:00:00Z",
  },
  text: "Outside, the night was cold and wet.",
  segments: [
    {
      index: 0,
      unit_ids: ["u0"],
      speaker_id: "narrator",
      text: "Outside, the night was cold and wet.",
      source_start: 0,
      source_end: 36,
      emotion: "somber",
    },
  ],
  characters: [
    {
      id: "narrator",
      name: "Narrator",
      aliases: [],
      traits: ["warm", "clear"],
      last_seen_chunk: 0,
    },
  ],
  rendered_count: 1,
  total_count: 1,
};

describe("StoryScene", () => {
  it("renders empty stage prompt when no story is selected", () => {
    render(
      <StoryScene
        story={null}
        currentSegmentIndex={0}
        activeOperation={null}
        onAnalyze={() => {}}
        onRender={() => {}}
        onCancelOperation={() => {}}
      />
    );

    expect(screen.getByText("The Stage Awaits")).toBeDefined();
  });

  it("renders story details and current segment reading preview", () => {
    const onAnalyze = vi.fn();
    const onRender = vi.fn();

    render(
      <StoryScene
        story={mockStory}
        currentSegmentIndex={0}
        activeOperation={null}
        onAnalyze={onAnalyze}
        onRender={onRender}
        onCancelOperation={() => {}}
      />
    );

    expect(screen.getByText("The Monkey's Paw")).toBeDefined();
    expect(screen.getByText(/Outside, the night was cold and wet/i)).toBeDefined();
    expect(screen.getByText("Narrator")).toBeDefined();

    fireEvent.click(screen.getByText(/Re-Analyze/i));
    expect(onAnalyze).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(/Render Voices/i));
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("displays operation banner with cancel button during active operation", () => {
    const onCancel = vi.fn();

    render(
      <StoryScene
        story={mockStory}
        currentSegmentIndex={0}
        activeOperation={{
          operation_id: "op-1",
          kind: "render",
          state: "running",
          completed: 12,
          total: 24,
          message_code: "segment_rendered",
          error: null,
        }}
        onAnalyze={() => {}}
        onRender={() => {}}
        onCancelOperation={onCancel}
      />
    );

    expect(screen.getByText(/12\/24/)).toBeDefined();
    expect(screen.getByText(/segment rendered/i)).toBeDefined();

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("displays operation error banner with open settings and dismiss button", () => {
    const onDismiss = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <StoryScene
        story={mockStory}
        currentSegmentIndex={0}
        activeOperation={null}
        operationError="Gemini API key is required"
        onDismissError={onDismiss}
        onOpenSettings={onOpenSettings}
        onAnalyze={() => {}}
        onRender={() => {}}
        onCancelOperation={() => {}}
      />
    );

    expect(screen.getByText(/Gemini API key is required/i)).toBeDefined();
    fireEvent.click(screen.getByText("Open Settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(/Dismiss/i));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders download button and triggers onDownload when clicked", () => {
    const onDownload = vi.fn();

    render(
      <StoryScene
        story={mockStory}
        currentSegmentIndex={0}
        activeOperation={null}
        onAnalyze={() => {}}
        onRender={() => {}}
        onCancelOperation={() => {}}
        onDownload={onDownload}
      />
    );

    const downloadBtn = screen.getByText(/Download Audio/i);
    expect(downloadBtn).toBeDefined();
    fireEvent.click(downloadBtn);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("disables download button when no segments are voiced", () => {
    const storyUnrendered = { ...mockStory, rendered_count: 0 };
    const onDownload = vi.fn();

    render(
      <StoryScene
        story={storyUnrendered}
        currentSegmentIndex={0}
        activeOperation={null}
        onAnalyze={() => {}}
        onRender={() => {}}
        onCancelOperation={() => {}}
        onDownload={onDownload}
      />
    );

    const downloadBtn = screen.getByRole("button", { name: /Download Audio/i });
    expect(downloadBtn.hasAttribute("disabled")).toBe(true);
  });
});

