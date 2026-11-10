import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StoryRail } from "../StoryRail";
import { StorySummary } from "../../types";

const mockStories: StorySummary[] = [
  {
    story_id: "story-1",
    title: "The Monkey's Paw",
    source_name: "monkeys-paw.txt",
    created_at: "2026-11-10T00:00:00Z",
    segment_count: 24,
    character_count: 4,
    rendered_segment_count: 24,
    has_analysis: true,
  },
  {
    story_id: "story-2",
    title: "The Tell-Tale Heart",
    source_name: null,
    created_at: "2026-11-10T01:00:00Z",
    segment_count: 15,
    character_count: 2,
    rendered_segment_count: 0,
    has_analysis: true,
  },
];

describe("StoryRail", () => {
  it("renders the fixed add-story button permanently above the story list", () => {
    const onAdd = vi.fn();
    render(
      <StoryRail
        stories={mockStories}
        selectedStoryId="story-1"
        onSelectStory={() => {}}
        onAddStory={onAdd}
        onDeleteStory={() => {}}
      />
    );

    const addBtn = screen.getByRole("button", { name: /Add a new story/i });
    expect(addBtn).toBeDefined();

    // Verify button is inside .story-rail-top, not inside .story-scroll-area
    expect(addBtn.closest(".story-rail-top")).not.toBeNull();
    expect(addBtn.closest(".story-scroll-area")).toBeNull();

    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("renders story cards and handles selection and deletion", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();

    render(
      <StoryRail
        stories={mockStories}
        selectedStoryId="story-1"
        onSelectStory={onSelect}
        onAddStory={() => {}}
        onDeleteStory={onDelete}
      />
    );

    expect(screen.getByText("The Monkey's Paw")).toBeDefined();
    expect(screen.getByText("The Tell-Tale Heart")).toBeDefined();

    // Click second card
    fireEvent.click(screen.getByText("The Tell-Tale Heart"));
    expect(onSelect).toHaveBeenCalledWith("story-2");

    // Click delete on first card
    const delBtn = screen.getByRole("button", { name: "Delete The Monkey's Paw" });
    fireEvent.click(delBtn);
    expect(onDelete).toHaveBeenCalledWith("story-1");
  });
});

