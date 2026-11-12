import { api } from "../api/client";
import { Segment } from "../types";

export interface AudioPlaybackState {
  isPlaying: boolean;
  currentSegmentIndex: number;
  currentTime: number;
  totalDuration: number;
  segmentTime: number;
  segmentDuration: number;
  volume: number;
  isLoading: boolean;
  error?: string | null;
}

export class WebAudioStoryPlayer {
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private storyId: string | null = null;
  private segments: Segment[] = [];
  private speakerPauseMs = 180;
  private bufferCache = new Map<number, AudioBuffer>();
  private durationMap = new Map<number, number>();
  private pendingLoads = new Map<number, Promise<AudioBuffer | null>>();
  private isPlaying = false;
  private currentSegmentIndex = 0;
  private segmentStartTime = 0;
  private pauseOffset = 0;
  private volume = 1;
  private totalDuration = 0;
  private elapsedBeforeCurrent = 0;
  private onStateChange: ((state: AudioPlaybackState) => void) | null = null;
  private animFrameId: number | null = null;
  private speakerPauseTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackGeneration = 0;
  private loadGeneration = 0;
  private lastTickAt = 0;

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private estimatedDuration(index: number): number {
    const words = this.segments[index]?.text.trim().split(/\s+/).filter(Boolean).length || 1;
    return Math.max(1.2, words / 2.6);
  }

  private durationFor(index: number): number {
    return this.durationMap.get(index) || this.estimatedDuration(index);
  }

  private recalculateTimeline(): void {
    let total = 0;
    let elapsed = 0;
    for (let index = 0; index < this.segments.length; index += 1) {
      const duration = this.durationFor(index);
      total += duration;
      if (index < this.currentSegmentIndex) elapsed += duration;
    }
    this.totalDuration = total;
    this.elapsedBeforeCurrent = elapsed;
  }

  public setStory(storyId: string, segments: Segment[], speakerPauseMs = 180): void {
    this.loadGeneration += 1;
    this.haltPlayback(false);
    this.storyId = storyId;
    this.segments = segments;
    this.speakerPauseMs = speakerPauseMs;
    this.bufferCache.clear();
    this.durationMap.clear();
    this.pendingLoads.clear();
    this.currentSegmentIndex = 0;
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();
  }

  public clearStory(): void {
    this.loadGeneration += 1;
    this.haltPlayback(false);
    this.storyId = null;
    this.segments = [];
    this.bufferCache.clear();
    this.durationMap.clear();
    this.pendingLoads.clear();
    this.currentSegmentIndex = 0;
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();
  }

  public subscribe(callback: (state: AudioPlaybackState) => void): () => void {
    this.onStateChange = callback;
    this.emitState();
    return () => {
      if (this.onStateChange === callback) this.onStateChange = null;
    };
  }

  private emitState(error?: string | null, isLoading = false): void {
    if (!this.onStateChange) return;

    let segmentTime = this.pauseOffset;
    if (this.isPlaying && this.audioCtx && this.currentSource) {
      segmentTime = Math.max(0, this.audioCtx.currentTime - this.segmentStartTime);
    }
    const segmentDuration = this.segments.length > 0 ? this.durationFor(this.currentSegmentIndex) : 0;
    segmentTime = Math.min(segmentTime, segmentDuration);

    this.onStateChange({
      isPlaying: this.isPlaying,
      currentSegmentIndex: this.currentSegmentIndex,
      currentTime: Math.min(this.elapsedBeforeCurrent + segmentTime, this.totalDuration),
      totalDuration: this.totalDuration,
      segmentTime,
      segmentDuration,
      volume: this.volume,
      isLoading,
      error,
    });
  }

  private startTick(): void {
    this.stopTick();
    this.lastTickAt = 0;
    const tick = (timestamp: number) => {
      if (!this.isPlaying) return;
      if (timestamp - this.lastTickAt >= 80) {
        this.lastTickAt = timestamp;
        this.emitState();
      }
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTick(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private clearSpeakerPause(): void {
    if (this.speakerPauseTimer) {
      clearTimeout(this.speakerPauseTimer);
      this.speakerPauseTimer = null;
    }
  }

  private async fetchAndDecode(index: number): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(index);
    if (cached) return cached;
    const pending = this.pendingLoads.get(index);
    if (pending) return pending;
    if (!this.storyId || index < 0 || index >= this.segments.length) return null;

    const storyId = this.storyId;
    const generation = this.loadGeneration;
    const load = (async () => {
      try {
        const raw = await api.fetchSegmentAudio(storyId, index);
        if (generation !== this.loadGeneration || storyId !== this.storyId) return null;
        const decoded = await this.ensureAudioContext().decodeAudioData(raw);
        if (generation !== this.loadGeneration || storyId !== this.storyId) return null;
        this.bufferCache.set(index, decoded);
        this.durationMap.set(index, decoded.duration);
        this.recalculateTimeline();
        this.emitState();
        return decoded;
      } catch {
        return null;
      }
    })();

    this.pendingLoads.set(index, load);
    load.finally(() => {
      if (this.pendingLoads.get(index) === load) this.pendingLoads.delete(index);
    });
    return load;
  }

  private preloadUpcoming(fromIndex: number, count = 3): void {
    for (let index = fromIndex; index < Math.min(this.segments.length, fromIndex + count); index += 1) {
      if (!this.bufferCache.has(index)) void this.fetchAndDecode(index);
    }
    for (const key of this.bufferCache.keys()) {
      if (key < fromIndex - 2 || key > fromIndex + 6) this.bufferCache.delete(key);
    }
  }

  public async play(): Promise<void> {
    if (this.segments.length === 0 || !this.storyId || (this.isPlaying && this.currentSource)) return;

    this.clearSpeakerPause();
    this.ensureAudioContext();
    this.isPlaying = true;
    const generation = ++this.playbackGeneration;
    this.emitState(null, true);

    const buffer = await this.fetchAndDecode(this.currentSegmentIndex);
    if (generation !== this.playbackGeneration || !this.isPlaying) return;
    if (!buffer) {
      this.isPlaying = false;
      this.emitState("Missing audio segment. Render the story first.");
      return;
    }

    this.playBuffer(buffer, this.pauseOffset);
    this.startTick();
    this.preloadUpcoming(this.currentSegmentIndex + 1, 3);
  }

  private playBuffer(buffer: AudioBuffer, offsetSeconds = 0): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
    }

    const context = this.ensureAudioContext();
    const source = context.createBufferSource();
    const safeOffset = Math.min(Math.max(0, offsetSeconds), Math.max(0, buffer.duration - 0.01));
    source.buffer = buffer;
    source.connect(this.gainNode!);
    this.segmentStartTime = context.currentTime - safeOffset;
    this.pauseOffset = safeOffset;
    this.currentSource = source;

    source.onended = () => {
      if (!this.isPlaying || this.currentSource !== source) return;
      this.currentSource = null;
      this.advanceToNextSegment();
    };
    source.start(0, safeOffset);
    this.emitState();
  }

  private advanceToNextSegment(): void {
    const nextIndex = this.currentSegmentIndex + 1;
    if (nextIndex >= this.segments.length) {
      this.haltPlayback(false);
      this.currentSegmentIndex = 0;
      this.pauseOffset = 0;
      this.recalculateTimeline();
      this.emitState();
      return;
    }

    const previousSpeaker = this.segments[this.currentSegmentIndex]?.speaker_id;
    const nextSpeaker = this.segments[nextIndex]?.speaker_id;
    const pauseDuration = previousSpeaker && nextSpeaker && previousSpeaker !== nextSpeaker
      ? this.speakerPauseMs
      : 0;
    const generation = this.playbackGeneration;
    this.currentSegmentIndex = nextIndex;
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();

    this.speakerPauseTimer = setTimeout(async () => {
      this.speakerPauseTimer = null;
      if (!this.isPlaying || generation !== this.playbackGeneration) return;
      const nextBuffer = await this.fetchAndDecode(nextIndex);
      if (!this.isPlaying || generation !== this.playbackGeneration) return;
      if (!nextBuffer) {
        this.pause();
        this.emitState("The next audio line is missing.");
        return;
      }
      this.playBuffer(nextBuffer);
      this.preloadUpcoming(nextIndex + 1, 3);
    }, pauseDuration);
  }

  private haltPlayback(preserveOffset: boolean): void {
    this.playbackGeneration += 1;
    this.isPlaying = false;
    this.stopTick();
    this.clearSpeakerPause();

    if (this.audioCtx && this.currentSource) {
      if (preserveOffset) {
        this.pauseOffset = Math.max(0, this.audioCtx.currentTime - this.segmentStartTime);
      }
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }
  }

  public pause(): void {
    if (!this.isPlaying && !this.currentSource && !this.speakerPauseTimer) return;
    this.haltPlayback(true);
    this.emitState();
  }

  public stop(): void {
    this.haltPlayback(false);
    this.pauseOffset = 0;
    this.emitState();
  }

  public prev(): void {
    if (this.segments.length === 0) return;
    const wasPlaying = this.isPlaying;
    this.haltPlayback(false);
    this.currentSegmentIndex = Math.max(0, this.currentSegmentIndex - 1);
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();
    if (wasPlaying) void this.play();
  }

  public next(): void {
    if (this.segments.length === 0) return;
    const wasPlaying = this.isPlaying;
    this.haltPlayback(false);
    this.currentSegmentIndex = Math.min(this.segments.length - 1, this.currentSegmentIndex + 1);
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();
    if (wasPlaying) void this.play();
  }

  public seekSegment(index: number): void {
    if (index < 0 || index >= this.segments.length) return;
    const wasPlaying = this.isPlaying;
    this.haltPlayback(false);
    this.currentSegmentIndex = index;
    this.pauseOffset = 0;
    this.recalculateTimeline();
    this.emitState();
    if (wasPlaying) void this.play();
  }

  public seekToTime(seconds: number): void {
    if (this.segments.length === 0) return;
    const target = Math.min(Math.max(0, seconds), this.totalDuration);
    let elapsed = 0;
    let targetIndex = this.segments.length - 1;
    for (let index = 0; index < this.segments.length; index += 1) {
      const duration = this.durationFor(index);
      if (target < elapsed + duration || index === this.segments.length - 1) {
        targetIndex = index;
        break;
      }
      elapsed += duration;
    }

    const wasPlaying = this.isPlaying;
    this.haltPlayback(false);
    this.currentSegmentIndex = targetIndex;
    this.pauseOffset = Math.min(target - elapsed, this.durationFor(targetIndex));
    this.recalculateTimeline();
    this.emitState();
    if (wasPlaying) void this.play();
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) this.gainNode.gain.value = this.volume;
    this.emitState();
  }

  public clearError(): void {
    this.emitState(null);
  }
}

export const storyAudioPlayer = new WebAudioStoryPlayer();
