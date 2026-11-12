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

export const StoryRail: React.FC<StoryRailProps> = React.memo(function StoryRail({
  stories,
  selectedStoryId,
  onSelectStory,
  onAddStory,
  onDeleteStory,
}) {
  return (
    <aside className="story-rail" aria-label="Story Library">
      <div className="story-rail-top">
        <div className="rail-heading">
          <div>
            <h2>Library</h2>
          </div>
          <span className="rail-count" aria-label={`${stories.length} stories`}>{stories.length}</span>
        </div>
        <button
          className="add-story-btn"
          onClick={onAddStory}
          aria-label="Add a new story"
          title="Import or create a new story"
        >
          <PlusIcon size={16} />
          <span>New Story</span>
        </button>
      </div>

      <div className="story-scroll-area" role="list">
        {stories.length === 0 ? (
          <div className="rail-empty-state">
            <span className="empty-ornament" aria-hidden="true" />
            <strong>No stories yet</strong>
            <span>Add a story to get started.</span>
          </div>
        ) : (
          stories.map((story, storyIndex) => {
            const isSelected = story.story_id === selectedStoryId;
            const progress = story.segment_count > 0
              ? Math.round((story.rendered_segment_count / story.segment_count) * 100)
              : 0;
            const status = !story.has_analysis
              ? "Needs analysis"
              : story.rendered_segment_count === story.segment_count && story.segment_count > 0
                ? "Ready to listen"
                : story.rendered_segment_count > 0
                  ? `${story.rendered_segment_count}/${story.segment_count} voiced`
                  : "Ready to render";

            return (
              <article
                key={story.story_id}
                role="listitem"
                className={`story-card ${isSelected ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="story-card-select"
                  onClick={() => onSelectStory(story.story_id)}
                  aria-pressed={isSelected}
                  title={`${story.title}, added ${new Date(story.created_at).toLocaleDateString()}`}
                >
                  <span className="story-card-number" aria-hidden="true">
                    {String(storyIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="story-card-copy">
                    <h3 className="story-card-title">{story.title}</h3>
                    <span className="story-card-meta">
                      <span>{status}</span>
                      <span>{story.character_count} cast</span>
                    </span>
                    <span className="story-card-progress" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="story-delete-btn"
                  onClick={() => onDeleteStory(story.story_id)}
                  title={`Delete ${story.title}`}
                  aria-label={`Delete ${story.title}`}
                >
                  <TrashIcon size={13} />
                </button>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
});
