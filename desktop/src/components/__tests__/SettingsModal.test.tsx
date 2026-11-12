import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal } from "../SettingsModal";
import { api } from "../../api/client";

vi.mock("../../api/client", () => ({
  api: {
    getConfig: vi.fn(),
    patchConfig: vi.fn(),
    setSecret: vi.fn(),
    downloadKokoroAssets: vi.fn(),
    getOperation: vi.fn(),
  },
}));

const mockConfig = {
  llm: { provider: "groq", model: "llama-3.3-70b-versatile" },
  tts: { provider: "elevenlabs", model: "eleven_multilingual_v2" },
};

const mockSetupStatus = {
  groq_key_present: true,
  elevenlabs_key_present: true,
  gemini_key_present: false,
  kokoro_model_present: false,
  kokoro_voices_present: false,
  ollama_models: [],
};

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getConfig as any).mockResolvedValue(mockConfig);
    (api.patchConfig as any).mockResolvedValue({ status: "ok" });
  });

  it("renders compact macOS-style layout with side-by-side engine cards", async () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        isOpen={true}
        onClose={onClose}
        setupStatus={mockSetupStatus as any}
        onRefreshStatus={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
    });

    expect(screen.getByText("Story Analysis")).toBeDefined();
    expect(screen.getByText("Voice & Speech (TTS)")).toBeDefined();
    expect(screen.getByText("API Credentials")).toBeDefined();

    // Check Close '✕' button in header
    const closeX = screen.getByRole("button", { name: /Close settings/i });
    expect(closeX).toBeDefined();
    fireEvent.click(closeX);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles saving config properly", async () => {
    const onRefreshStatus = vi.fn();
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        setupStatus={mockSetupStatus as any}
        onRefreshStatus={onRefreshStatus}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save Settings/i })).toBeDefined();
    });

    const saveBtn = screen.getByRole("button", { name: /Save Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.patchConfig).toHaveBeenCalledTimes(1);
      expect(onRefreshStatus).toHaveBeenCalledTimes(1);
    });
  });
});

