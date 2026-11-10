import { api } from "../api/client";
import { Segment } from "../types";

export interface AudioPlaybackState {
  isPlaying: boolean;
  currentSegmentIndex: number;
  currentTime: number;
  totalDuration: number;
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
  private speakerPauseMs: number = 180;

  // Buffer cache: segmentIndex -> AudioBuffer
  private bufferCache: Map<number, AudioBuffer> = new Map();
  private durationMap: Map<number, number> = new Map();

  // Playback state
  private isPlaying: boolean = false;
  private currentSegmentIndex: number = 0;
  private segmentStartTime: number = 0; // audioCtx.currentTime when segment started
  private pauseOffset: number = 0; // seconds into current segment when paused
  private volume: number = 1.0;

  private onStateChange: ((state: AudioPlaybackState) => void) | null = null;
  private animFrameId: number | null = null;

  constructor() {
    // AudioContext will be initialized on user interaction
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  public setStory(storyId: string, segments: Segment[], speakerPauseMs = 180): void {
    this.stop();
    this.storyId = storyId;
    this.segments = segments;
    this.speakerPauseMs = speakerPauseMs;
    this.bufferCache.clear();
    this.durationMap.clear();
    this.currentSegmentIndex = 0;
    this.pauseOffset = 0;
    this.preloadUpcoming(0, 3);
    this.emitState();
  }

  public subscribe(callback: (state: AudioPlaybackState) => void): () => void {
    this.onStateChange = callback;
    this.emitState();
    return () => {
      if (this.onStateChange === callback) {
        this.onStateChange = null;
      }
    };
  }

  private emitState(error?: string | null, isLoading = false): void {
    if (!this.onStateChange) return;

    let totalDuration = 0;
    let accumulatedTime = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const d = this.durationMap.get(i) || 2.0; // estimate 2s if not decoded yet
      totalDuration += d;
      if (i < this.currentSegmentIndex) {
        accumulatedTime += d;
      }
    }

    let segTime = this.pauseOffset;
    if (this.isPlaying && this.audioCtx) {
      segTime = Math.max(0, this.audioCtx.currentTime - this.segmentStartTime);
    }
    const currentTime = accumulatedTime + segTime;

    this.onStateChange({
      isPlaying: this.isPlaying,
      currentSegmentIndex: this.currentSegmentIndex,
      currentTime: Math.min(currentTime, totalDuration),
      totalDuration,
      volume: this.volume,
      isLoading,
      error,
    });
  }

  private startTick(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    const tick = () => {
      if (this.isPlaying) {
        this.emitState();
        this.animFrameId = requestAnimationFrame(tick);
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTick(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private async fetchAndDecode(index: number): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(index)) {
      return this.bufferCache.get(index)!;
    }
    if (!this.storyId || index >= this.segments.length) return null;

    try {
      const raw = await api.fetchSegmentAudio(this.storyId, index);
      const ctx = this.ensureAudioContext();
      const decoded = await ctx.decodeAudioData(raw);
      this.bufferCache.set(index, decoded);
      this.durationMap.set(index, decoded.duration);
      return decoded;
    } catch {
      return null;
    }
  }

  private preloadUpcoming(fromIndex: number, count = 3): void {
    // Keep a bounded sliding window
    for (let i = fromIndex; i < Math.min(this.segments.length, fromIndex + count); i++) {
      if (!this.bufferCache.has(i)) {
        this.fetchAndDecode(i).catch(() => {});
      }
    }

    // Clean up old buffers far behind
    for (const key of Array.from(this.bufferCache.keys())) {
      if (key < fromIndex - 2 || key > fromIndex + 6) {
        this.bufferCache.delete(key);
      }
    }
  }

  public async play(): Promise<void> {
    if (this.segments.length === 0 || !this.storyId) return;

    this.ensureAudioContext();
    this.isPlaying = true;
    this.emitState(null, true);

    const buffer = await this.fetchAndDecode(this.currentSegmentIndex);
    if (!buffer) {
      this.isPlaying = false;
      this.emitState("Missing audio segment. Please render first.");
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
      this.currentSource = null;
    }

    const ctx = this.ensureAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode!);

    const startTime = ctx.currentTime;
    this.segmentStartTime = startTime - offsetSeconds;
    this.currentSource = source;

    source.onended = () => {
      if (!this.isPlaying) return;
      if (this.currentSource === source) {
        this.currentSource = null;
        this.advanceToNextSegment();
      }
    };

    source.start(0, offsetSeconds);
    this.emitState();
  }

  private advanceToNextSegment(): void {
    const nextIndex = this.currentSegmentIndex + 1;
    if (nextIndex >= this.segments.length) {
      this.stop();
      this.currentSegmentIndex = 0;
      this.pauseOffset = 0;
      this.emitState();
      return;
    }

    const prevSpeaker = this.segments[this.currentSegmentIndex]?.speaker_id;
    const nextSpeaker = this.segments[nextIndex]?.speaker_id;
    const shouldPause = prevSpeaker && nextSpeaker && prevSpeaker !== nextSpeaker;
    const pauseDuration = shouldPause ? this.speakerPauseMs : 0;

    this.currentSegmentIndex = nextIndex;
    this.pauseOffset = 0;

    setTimeout(async () => {
      if (!this.isPlaying) return;
      const nextBuf = await this.fetchAndDecode(nextIndex);
      if (!nextBuf) {
        this.pause();
        this.emitState("Missing next audio segment.");
        return;
      }
      this.playBuffer(nextBuf, 0);
      this.preloadUpcoming(nextIndex + 1, 3);
    }, pauseDuration);
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.stopTick();

    if (this.audioCtx && this.currentSource) {
      this.pauseOffset = Math.max(0, this.audioCtx.currentTime - this.segmentStartTime);
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }
    this.emitState();
  }

  public stop(): void {
    this.pause();
    this.pauseOffset = 0;
    this.emitState();
  }

  public prev(): void {
    const wasPlaying = this.isPlaying;
    this.pause();
    this.pauseOffset = 0;
    this.currentSegmentIndex = Math.max(0, this.currentSegmentIndex - 1);
    this.emitState();
    if (wasPlaying) {
      this.play();
    }
  }

  public next(): void {
    const wasPlaying = this.isPlaying;
    this.pause();
    this.pauseOffset = 0;
    this.currentSegmentIndex = Math.min(this.segments.length - 1, this.currentSegmentIndex + 1);
    this.emitState();
    if (wasPlaying) {
      this.play();
    }
  }

  public seekSegment(index: number): void {
    if (index < 0 || index >= this.segments.length) return;
    const wasPlaying = this.isPlaying;
    this.pause();
    this.currentSegmentIndex = index;
    this.pauseOffset = 0;
    this.emitState();
    if (wasPlaying) {
      this.play();
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
    this.emitState();
  }
}

export const storyAudioPlayer = new WebAudioStoryPlayer();

