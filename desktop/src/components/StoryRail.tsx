import React from "react";
import { StorySummary } from "../types";
import { PlusIcon, TrashIcon } from "./Icons";

interface StoryRailProps {
  stories: StorySummary[];
  selectedStoryId: string | null;
  onSelectStory: (storyId: string) => void;
  onAddStory: () => void;
  onDeleteStory: (storyId: string) => void;
}

export const StoryRail: React.FC<StoryRailProps> = ({
  stories,
  selectedStoryId,
  onSelectStory,
  onAddStory,
  onDeleteStory,
}) => {
  return (
    <aside className="story-rail" aria-label="Story Library">
      {/* Fixed Add Story control permanently at top */}
      <div className="story-rail-top">
        <button
          className="add-story-btn"
          onClick={onAddStory}
          aria-label="Add a new story"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
        >
          <PlusIcon size={15} /> Add Story
        </button>
      </div>

      {/* Independently scrollable story cards */}
      <div className="story-scroll-area" role="list">
        {stories.length === 0 ? (
          <div style={{ padding: "20px 10px", textAlign: "center", color: "#666", fontSize: "0.9rem" }}>
            No stories yet.<br />Click "+ Add Story" to begin.
          </div>
        ) : (
          stories.map((story) => {
            const isSelected = story.story_id === selectedStoryId;
            return (
              <div
                key={story.story_id}
                role="listitem"
                className={`story-card ${isSelected ? "active" : ""}`}
                onClick={() => onSelectStory(story.story_id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectStory(story.story_id);
                  }
                }}
                aria-selected={isSelected}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <h3 className="story-card-title">{story.title}</h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteStory(story.story_id);
                    }}
                    title="Delete story"
                    aria-label={`Delete ${story.title}`}
                    style={{
                      opacity: 0.6,
                      fontSize: "0.9rem",
                      padding: "4px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ink)",
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
                <div className="story-card-meta">
                  <span>
                    {story.has_analysis
                      ? `${story.rendered_segment_count}/${story.segment_count} voiced`
                      : "Needs analysis"}
                  </span>
                  <span>{new Date(story.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
