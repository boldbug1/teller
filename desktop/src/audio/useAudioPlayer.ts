import { useEffect, useState } from "react";
import { AudioPlaybackState, storyAudioPlayer } from "./player";
import { Segment } from "../types";

export function useAudioPlayer(storyId?: string, segments: Segment[] = [], speakerPauseMs = 180) {
  const [playbackState, setPlaybackState] = useState<AudioPlaybackState>({
    isPlaying: false,
    currentSegmentIndex: 0,
    currentTime: 0,
    totalDuration: 0,
    volume: 1.0,
    isLoading: false,
  });

  useEffect(() => {
    if (storyId) {
      storyAudioPlayer.setStory(storyId, segments, speakerPauseMs);
    }
  }, [storyId, segments, speakerPauseMs]);

  useEffect(() => {
    const unsubscribe = storyAudioPlayer.subscribe(setPlaybackState);
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    ...playbackState,
    play: () => storyAudioPlayer.play(),
    pause: () => storyAudioPlayer.pause(),
    prev: () => storyAudioPlayer.prev(),
    next: () => storyAudioPlayer.next(),
    seekSegment: (index: number) => storyAudioPlayer.seekSegment(index),
    setVolume: (vol: number) => storyAudioPlayer.setVolume(vol),
  };
}

