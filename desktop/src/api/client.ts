import {
  BackendInfo,
  Character,
  OperationEvent,
  SetupStatus,
  StoryDetail,
  StorySummary,
  VoiceItem,
} from "../types";

class ApiClient {
  private port: number = 8000;
  private token: string = "";
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private ws: WebSocket | null = null;
  private eventListeners: Set<(event: OperationEvent) => void> = new Set();

  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const info = await invoke<BackendInfo>("get_backend_info");
          this.port = info.port;
          this.token = info.token;
        } catch (err) {
          console.warn("Could not retrieve Tauri backend info, falling back to defaults", err);
        }
      } else {
        const meta = import.meta as any;
        const envPort = meta.env?.VITE_API_PORT;
        if (envPort) this.port = parseInt(envPort, 10);
        this.token = meta.env?.VITE_API_TOKEN || "";
      }

      this.initialized = true;
      this.connectWebSocket();
    })();
    return this.initPromise;
  }

  public setConnection(port: number, token: string): void {
    this.port = port;
    this.token = token;
    this.initialized = true;
    this.connectWebSocket();
  }

  public get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private get headers(): HeadersInit {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  private connectWebSocket(): void {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = `ws://127.0.0.1:${this.port}/v1/events`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Send bearer token authentication message
        if (this.token && this.ws) {
          this.ws.send(JSON.stringify({ token: this.token }));
        }
      };

      this.ws.onmessage = (ev) => {
        try {
          const event: OperationEvent = JSON.parse(ev.data);
          this.eventListeners.forEach((listener) => listener(event));
        } catch {
          // ignore non-json messages
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        // Auto-reconnect after 2 seconds
        setTimeout(() => this.connectWebSocket(), 2000);
      };
    } catch (e) {
      console.warn("Failed to connect websocket", e);
    }
  }

  public onOperationEvent(callback: (event: OperationEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  // --- API Endpoints ---

  public async getHealth(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/v1/health`);
    if (!res.ok) throw new Error("Health check failed");
    return res.json();
  }

  public async getSetupStatus(): Promise<SetupStatus> {
    const res = await fetch(`${this.baseUrl}/v1/setup/status`, { headers: this.headers });
    if (!res.ok) throw new Error(`Setup status failed: ${res.statusText}`);
    return res.json();
  }

  public async getConfig(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/config`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to load config");
    return res.json();
  }

  public async patchConfig(patch: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/config`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Failed to update config");
    return res.json();
  }

  public async setSecret(provider: string, key: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/secrets/${provider}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(`Failed to set secret for ${provider}`);
  }

  public async deleteSecret(provider: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/secrets/${provider}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Failed to delete secret for ${provider}`);
  }

  public async runDoctor(): Promise<{ checks: any[]; all_passed: boolean }> {
    const res = await fetch(`${this.baseUrl}/v1/doctor`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Doctor check failed");
    return res.json();
  }

  public async downloadKokoroAssets(): Promise<{ operation_id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/assets/kokoro`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Failed to start asset download");
    return res.json();
  }

  public async getStories(): Promise<StorySummary[]> {
    const res = await fetch(`${this.baseUrl}/v1/stories`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to load stories");
    return res.json();
  }

  public async getStory(storyId: string): Promise<StoryDetail> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Story ${storyId} not found`);
    return res.json();
  }

  public async importStory(path: string, title?: string): Promise<StorySummary> {
    const res = await fetch(`${this.baseUrl}/v1/stories/import`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ path, title }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Import failed");
    }
    return res.json();
  }

  public async uploadStoryFile(
    file: { name: string; base64?: string; path?: string },
    title?: string
  ): Promise<StorySummary> {
    const res = await fetch(`${this.baseUrl}/v1/stories/import`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        path: file.path,
        content_base64: file.base64,
        filename: file.name,
        title: title || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Upload failed");
    }
    return res.json();
  }

  public async pasteStory(text: string, title?: string): Promise<StorySummary> {
    const res = await fetch(`${this.baseUrl}/v1/stories/paste`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ text, title }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Failed to paste story");
    }
    return res.json();
  }

  public async deleteStory(storyId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Failed to delete story");
  }

  public async analyzeStory(storyId: string, force = false): Promise<{ operation_id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/analyze?force=${force}`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Failed to start analysis");
    return res.json();
  }

  public async renderStory(storyId: string): Promise<{ operation_id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/render`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Failed to start render");
    return res.json();
  }

  public async reassignVoices(storyId: string): Promise<{ operation_id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/reassign-voices`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to start voice reassignment");
    }
    return res.json();
  }

  public async getCast(storyId: string): Promise<Character[]> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/cast`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to fetch cast");
    return res.json();
  }

  public async updateCharacterVoice(
    storyId: string,
    characterId: string,
    voiceId: string,
    provider?: string,
    model?: string
  ): Promise<Character> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/cast/${characterId}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({ voice_id: voiceId, provider, model }),
    });
    if (!res.ok) throw new Error("Failed to update character voice");
    return res.json();
  }

  public async getVoices(): Promise<VoiceItem[]> {
    const res = await fetch(`${this.baseUrl}/v1/voices`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to fetch available voices");
    return res.json();
  }

  public async getOperation(opId: string): Promise<OperationEvent> {
    const res = await fetch(`${this.baseUrl}/v1/operations/${opId}`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to fetch operation status");
    return res.json();
  }

  public async cancelOperation(opId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/operations/${opId}/cancel`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("Failed to cancel operation");
  }

  public async fetchSegmentAudio(storyId: string, segmentIndex: number): Promise<ArrayBuffer> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/segments/${segmentIndex}/audio`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Audio segment ${segmentIndex} not available`);
    return res.arrayBuffer();
  }

  public getStoryDownloadUrl(storyId: string): string {
    return `${this.baseUrl}/v1/stories/${storyId}/download`;
  }

  public async downloadStoryAudio(storyId: string): Promise<Blob> {
    const res = await fetch(this.getStoryDownloadUrl(storyId), { headers: this.headers });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || `Download failed: HTTP ${res.status}`);
    }
    return res.blob();
  }

  public async exportStoryAudio(
    storyId: string,
    targetPath?: string
  ): Promise<{
    path: string;
    filename: string;
    size_bytes: number;
    duration_seconds: number;
    rendered_segments: number;
  }> {
    const res = await fetch(`${this.baseUrl}/v1/stories/${storyId}/export`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ target_path: targetPath }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to export audio");
    }
    return res.json();
  }
}

export const api = new ApiClient();
