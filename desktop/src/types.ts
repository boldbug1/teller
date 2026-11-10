export interface StoryManifest {
  story_id: string;
  title: string;
  source_name?: string | null;
  source_sha256: string;
  schema_version: number;
  tagger_revision: number;
  created_at: string;
}

export interface VoiceAssignment {
  provider: string;
  model: string;
  voice_id: string;
  language?: string | null;
}

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  gender?: string | null;
  age?: string | null;
  traits: string[];
  voice?: VoiceAssignment | null;
  last_seen_chunk: number;
}

export interface Segment {
  index: number;
  unit_ids: string[];
  speaker_id: string;
  text: string;
  source_start: number;
  source_end: number;
  emotion?: string | null;
  audio_file?: string | null;
}

export interface StorySummary {
  story_id: string;
  title: string;
  source_name?: string | null;
  created_at: string;
  segment_count: number;
  character_count: number;
  rendered_segment_count: number;
  has_analysis: boolean;
}

export interface StoryDetail {
  manifest: StoryManifest;
  text: string;
  segments: Segment[];
  characters: Character[];
  rendered_count: number;
  total_count: number;
}

export interface SetupStatus {
  llm_provider: string;
  tts_provider: string;
  gemini_key_present: boolean;
  groq_key_present?: boolean;
  elevenlabs_key_present: boolean;
  ollama_reachable: boolean;
  ollama_models: string[];
  ollama_model_available: boolean;
  kokoro_model_present: boolean;
  kokoro_voices_present: boolean;
  audio_output_available: boolean;
  ready: boolean;
}

export interface OperationEvent {
  operation_id: string;
  kind: string;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  completed: number;
  total: number;
  message_code: string;
  error?: string | null;
}

export interface VoiceItem {
  id: string;
  name: string;
  language?: string | null;
  gender?: string | null;
  age?: string | null;
  traits: string[];
}

export interface BackendInfo {
  port: number;
  token: string;
}

