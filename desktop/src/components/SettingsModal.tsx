import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { SetupStatus } from "../types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setupStatus: SetupStatus | null;
  onRefreshStatus: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  setupStatus,
  onRefreshStatus,
}) => {
  const [config, setConfig] = useState<any>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloadingKokoro, setDownloadingKokoro] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.getConfig().then(setConfig).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen || !config) return null;

  const handleSaveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.patchConfig(config);
      if (geminiKey.trim()) {
        await api.setSecret("gemini", geminiKey.trim());
        setGeminiKey("");
      }
      if (elevenlabsKey.trim()) {
        await api.setSecret("elevenlabs", elevenlabsKey.trim());
        setElevenlabsKey("");
      }
      onRefreshStatus();
      setMsg({ text: "Configuration saved successfully!", type: "success" });
    } catch (err: any) {
      setMsg({ text: err.message || "Failed to save configuration", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadKokoro = async () => {
    setDownloadingKokoro(true);
    try {
      await api.downloadKokoroAssets();
      setMsg({ text: "Kokoro asset download started.", type: "success" });
      onRefreshStatus();
    } catch (err: any) {
      setMsg({ text: err.message || "Failed to start download", type: "error" });
    } finally {
      setDownloadingKokoro(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-dialog">
        <h2 id="settings-title" className="modal-title">Provider & System Settings</h2>

        {msg && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: "12px",
              borderRadius: "2px",
              background: msg.type === "success" ? "#d4edda" : "#f8d7da",
              color: msg.type === "success" ? "#155724" : "#721c24",
              border: `1px solid ${msg.type === "success" ? "#c3e6cb" : "#f5c6cb"}`,
              fontSize: "0.85rem",
            }}
          >
            {msg.text}
          </div>
        )}

        {/* LLM Section */}
        <h3 style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Speaker Attribution (LLM)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Provider</label>
            <select
              value={config.llm.provider}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, provider: e.target.value },
                })
              }
            >
              <option value="gemini">Gemini (Cloud)</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Model</label>
            <input
              type="text"
              value={config.llm.model}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, model: e.target.value },
                })
              }
            />
          </div>
        </div>

        {/* TTS Section */}
        <h3 style={{ fontSize: "1.1rem", marginBottom: "8px" }}>Voice Synthesis (TTS)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Provider</label>
            <select
              value={config.tts.provider}
              onChange={(e) =>
                setConfig({
                  ...config,
                  tts: { ...config.tts, provider: e.target.value },
                })
              }
            >
              <option value="gemini">Gemini (Cloud)</option>
              <option value="kokoro">Kokoro ONNX (Local)</option>
              <option value="elevenlabs">ElevenLabs (Cloud)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Model</label>
            <input
              type="text"
              value={config.tts.model}
              onChange={(e) =>
                setConfig({
                  ...config,
                  tts: { ...config.tts, model: e.target.value },
                })
              }
            />
          </div>
        </div>

        {/* Credentials BYOK Section */}
        <h3 style={{ fontSize: "1.1rem", marginBottom: "8px" }}>API Credentials (BYOK)</h3>
        <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "-4px" }}>
          Keys are stored in your operating system credential manager and never returned to the frontend.
        </p>

        <div style={{ marginBottom: "10px" }}>
          <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>
            Gemini API Key {setupStatus?.gemini_key_present ? "✓ (Stored in Keyring)" : "(Not set)"}
          </label>
          <input
            type="text"
            placeholder={setupStatus?.gemini_key_present ? "••••••••••••••••" : "Paste Gemini API Key"}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: "14px" }}>
          <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>
            ElevenLabs API Key {setupStatus?.elevenlabs_key_present ? "✓ (Stored in Keyring)" : "(Not set)"}
          </label>
          <input
            type="text"
            placeholder={setupStatus?.elevenlabs_key_present ? "••••••••••••••••" : "Paste ElevenLabs API Key"}
            value={elevenlabsKey}
            onChange={(e) => setElevenlabsKey(e.target.value)}
          />
        </div>

        {/* Kokoro Assets Section */}
        <div style={{ padding: "12px", background: "var(--paper-card)", border: "1px dashed var(--ink)", borderRadius: "3px", marginBottom: "16px" }}>
          <div style={{ fontWeight: "bold", fontSize: "0.9rem", marginBottom: "4px" }}>
            Kokoro Offline Assets (142 MB)
          </div>
          <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "8px" }}>
            Status: {setupStatus?.kokoro_model_present && setupStatus?.kokoro_voices_present
              ? "✓ Models & Voices present on disk"
              : "⚠️ Assets not found"}
          </div>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: "0.8rem" }}
            onClick={handleDownloadKokoro}
            disabled={downloadingKokoro}
          >
            {downloadingKokoro ? "Starting download..." : "Download Kokoro Assets"}
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={handleSaveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

