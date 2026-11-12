import { useEffect, useState } from "react";
import { AudioPlaybackState, storyAudioPlayer } from "./player";
import { Segment } from "../types";

const EMPTY_SEGMENTS: Segment[] = [];
const audioControls = {
  play: () => storyAudioPlayer.play(),
  pause: () => storyAudioPlayer.pause(),
  prev: () => storyAudioPlayer.prev(),
  next: () => storyAudioPlayer.next(),
  seekSegment: (index: number) => storyAudioPlayer.seekSegment(index),
  seekToTime: (seconds: number) => storyAudioPlayer.seekToTime(seconds),
  setVolume: (volume: number) => storyAudioPlayer.setVolume(volume),
  clearError: () => storyAudioPlayer.clearError(),
};

export function useAudioPlayer(storyId?: string, segments: Segment[] = [], speakerPauseMs = 180) {
  const [playbackState, setPlaybackState] = useState<AudioPlaybackState>({
    isPlaying: false,
    currentSegmentIndex: 0,
    currentTime: 0,
    totalDuration: 0,
    segmentTime: 0,
    segmentDuration: 0,
    volume: 1.0,
    isLoading: false,
  });

  const activeSegments = storyId ? segments : EMPTY_SEGMENTS;

  useEffect(() => {
    if (storyId) {
      storyAudioPlayer.setStory(storyId, activeSegments, speakerPauseMs);
    } else {
      storyAudioPlayer.clearStory();
    }
  }, [storyId, activeSegments, speakerPauseMs]);

  useEffect(() => {
    const unsubscribe = storyAudioPlayer.subscribe(setPlaybackState);
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    ...playbackState,
    ...audioControls,
  };
}
