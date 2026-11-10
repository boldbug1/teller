import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { SetupStatus } from "../types";
import { CheckIcon, EyeIcon, EyeOffIcon, SettingsIcon, WarningIcon } from "./Icons";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setupStatus: SetupStatus | null;
  onRefreshStatus: () => void;
}

const GEMINI_LLM_MODELS = [
  { value: "gemini-3.8-flash", label: "gemini-3.8-flash (Recommended - fast & high quality)" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash (Standard)" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro (In-depth analysis)" },
];

const OLLAMA_DEFAULT_MODELS = [
  "llama3.2",
  "mistral",
  "qwen2.5",
  "phi3",
  "gemma2",
];

const ELEVENLABS_MODELS = [
  { value: "eleven_multilingual_v2", label: "eleven_multilingual_v2 (Most Expressive - Recommended)" },
  { value: "eleven_turbo_v2_5", label: "eleven_turbo_v2_5 (Low latency)" },
  { value: "eleven_flash_v2_5", label: "eleven_flash_v2_5 (Ultra fast)" },
  { value: "eleven_multilingual_v1", label: "eleven_multilingual_v1 (Classic)" },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  setupStatus,
  onRefreshStatus,
}) => {
  const [config, setConfig] = useState<any>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showElevenlabsKey, setShowElevenlabsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingKokoro, setDownloadingKokoro] = useState(false);
  const [kokoroProgress, setKokoroProgress] = useState<number | null>(null);
  const [kokoroMessage, setKokoroMessage] = useState<string>("");
  const [customLlmModel, setCustomLlmModel] = useState(false);
  const [customTtsModel, setCustomTtsModel] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.getConfig().then((cfg) => {
        setConfig(cfg);
        // Detect if currently configured model is custom
        if (cfg.llm.provider === "gemini" && !GEMINI_LLM_MODELS.some((m) => m.value === cfg.llm.model)) {
          setCustomLlmModel(true);
        }
        if (cfg.tts.provider === "elevenlabs" && !ELEVENLABS_MODELS.some((m) => m.value === cfg.tts.model)) {
          setCustomTtsModel(true);
        }
      }).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen || !config) return null;

  const handleSaveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.patchConfig(config);
      let keySavedCount = 0;
      if (geminiKey.trim()) {
        await api.setSecret("gemini", geminiKey.trim());
        keySavedCount++;
      }
      if (elevenlabsKey.trim()) {
        await api.setSecret("elevenlabs", elevenlabsKey.trim());
        keySavedCount++;
      }
      onRefreshStatus();
      setMsg({
        text: keySavedCount > 0
          ? `Settings & ${keySavedCount} API key${keySavedCount > 1 ? "s" : ""} saved successfully!`
          : "Settings saved successfully!",
        type: "success",
      });
    } catch (err: any) {
      setMsg({ text: err.message || "Failed to save settings", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadKokoro = async () => {
    setDownloadingKokoro(true);
    setKokoroProgress(0);
    setKokoroMessage("Initiating download...");
    try {
      const res = await api.downloadKokoroAssets();
      const opId = res.operation_id;

      const interval = setInterval(async () => {
        try {
          const op = await api.getOperation(opId);
          if (op) {
            if (op.total > 0) {
              const pct = Math.min(100, Math.round((op.completed / op.total) * 100));
              setKokoroProgress(pct);
            }
            if (op.message_code) {
              setKokoroMessage(op.message_code.replace(/_/g, " "));
            }
            if (op.state === "completed") {
              clearInterval(interval);
              setKokoroProgress(100);
              setKokoroMessage("Kokoro voice assets ready!");
              setDownloadingKokoro(false);
              onRefreshStatus();
              setMsg({ text: "Kokoro offline voice assets downloaded successfully!", type: "success" });
            } else if (op.state === "failed") {
              clearInterval(interval);
              setDownloadingKokoro(false);
              setKokoroProgress(null);
              setMsg({ text: `Download failed: ${op.error || op.message_code}`, type: "error" });
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 500);
    } catch (err: any) {
      setDownloadingKokoro(false);
      setKokoroProgress(null);
      setMsg({ text: err.message || "Failed to start download", type: "error" });
    }
  };

  // Compile Ollama models from setup status and defaults
  const ollamaOptions = Array.from(
    new Set([...(setupStatus?.ollama_models || []), ...OLLAMA_DEFAULT_MODELS])
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-dialog">
        <h2 id="settings-title" className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SettingsIcon size={20} /> Settings
        </h2>

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

        {/* Section 1: Story Analysis */}
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "2px" }}>Story Analysis & Characters</h3>
          <p style={{ fontSize: "0.78rem", color: "#666", margin: "0 0 8px 0" }}>
            The AI model used to detect dialogue, characters, and emotions in your stories.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Provider</label>
              <select
                value={config.llm.provider}
                onChange={(e) => {
                  const prov = e.target.value;
                  const defModel = prov === "gemini" ? "gemini-3.8-flash" : prov === "rule_based" ? "builtin" : (setupStatus?.ollama_models?.[0] || "llama3.2");
                  setCustomLlmModel(false);
                  setConfig({
                    ...config,
                    llm: { ...config.llm, provider: prov, model: defModel },
                  });
                }}
              >
                <option value="gemini">Gemini (Cloud AI)</option>
                <option value="rule_based">Rule-Based / Instant (100% Offline & Free)</option>
                <option value="ollama">Ollama (Local AI / Offline)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Model</label>
              {config.llm.provider === "rule_based" ? (
                <select disabled value="builtin">
                  <option value="builtin">Built-in Dialogue & Cast Parser</option>
                </select>
              ) : config.llm.provider === "gemini" ? (
                <>
                  <select
                    value={customLlmModel ? "custom" : config.llm.model}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        setCustomLlmModel(true);
                      } else {
                        setCustomLlmModel(false);
                        setConfig({
                          ...config,
                          llm: { ...config.llm, model: e.target.value },
                        });
                      }
                    }}
                  >
                    {GEMINI_LLM_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    <option value="custom">Custom model name...</option>
                  </select>
                  {customLlmModel && (
                    <input
                      type="text"
                      placeholder="Enter Gemini model name"
                      value={config.llm.model}
                      style={{ marginTop: "6px" }}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          llm: { ...config.llm, model: e.target.value },
                        })
                      }
                    />
                  )}
                </>
              ) : (
                <>
                  <select
                    value={customLlmModel ? "custom" : config.llm.model}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        setCustomLlmModel(true);
                      } else {
                        setCustomLlmModel(false);
                        setConfig({
                          ...config,
                          llm: { ...config.llm, model: e.target.value },
                        });
                      }
                    }}
                  >
                    {ollamaOptions.map((modelName) => (
                      <option key={modelName} value={modelName}>
                        {modelName} {setupStatus?.ollama_models?.includes(modelName) ? "(Installed)" : ""}
                      </option>
                    ))}
                    <option value="custom">Custom model name...</option>
                  </select>
                  {customLlmModel && (
                    <input
                      type="text"
                      placeholder="Enter Ollama model name"
                      value={config.llm.model}
                      style={{ marginTop: "6px" }}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          llm: { ...config.llm, model: e.target.value },
                        })
                      }
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Voice & Speech */}
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "2px" }}>Voice & Speech (Text to Speech)</h3>
          <p style={{ fontSize: "0.78rem", color: "#666", margin: "0 0 8px 0" }}>
            The voice engine that reads and speaks character lines out loud.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Voice Provider</label>
              <select
                value={config.tts.provider}
                onChange={(e) => {
                  const prov = e.target.value;
                  let defModel = "gemini-3.8-flash-lite-tts";
                  if (prov === "kokoro") defModel = "kokoro-v1.0-int8";
                  if (prov === "elevenlabs") defModel = "eleven_multilingual_v2";
                  setCustomTtsModel(false);
                  setConfig({
                    ...config,
                    tts: { ...config.tts, provider: prov, model: defModel },
                  });
                }}
              >
                <option value="gemini">Gemini (Cloud)</option>
                <option value="kokoro">Kokoro (Offline / Local)</option>
                <option value="elevenlabs">ElevenLabs (High-Realism Cloud)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Voice Model</label>
              {config.tts.provider === "elevenlabs" ? (
                <>
                  <select
                    value={customTtsModel ? "custom" : config.tts.model}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        setCustomTtsModel(true);
                      } else {
                        setCustomTtsModel(false);
                        setConfig({
                          ...config,
                          tts: { ...config.tts, model: e.target.value },
                        });
                      }
                    }}
                  >
                    {ELEVENLABS_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    <option value="custom">Custom model...</option>
                  </select>
                  {customTtsModel && (
                    <input
                      type="text"
                      placeholder="Enter ElevenLabs model name"
                      value={config.tts.model}
                      style={{ marginTop: "6px" }}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          tts: { ...config.tts, model: e.target.value },
                        })
                      }
                    />
                  )}
                </>
              ) : config.tts.provider === "kokoro" ? (
                <select
                  value={config.tts.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      tts: { ...config.tts, model: e.target.value },
                    })
                  }
                >
                  <option value="kokoro-v1.0-int8">kokoro-v1.0-int8 (Built-in offline)</option>
                </select>
              ) : (
                <select
                  value={config.tts.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      tts: { ...config.tts, model: e.target.value },
                    })
                  }
                >
                  <option value="gemini-3.8-flash-lite-tts">gemini-3.8-flash-lite-tts (Standard)</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: API Keys (Only shown when a cloud provider is selected) */}
        {(() => {
          const needsGeminiKey = config.llm.provider === "gemini" || config.tts.provider === "gemini";
          const needsElevenlabsKey = config.tts.provider === "elevenlabs";
          const anyKeyNeeded = needsGeminiKey || needsElevenlabsKey;

          return (
            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1.05rem", marginBottom: "2px" }}>API Keys</h3>
              <p style={{ fontSize: "0.78rem", color: "#666", margin: "0 0 8px 0" }}>
                Keys are saved in your system credential manager and never exposed in plain text.
              </p>

              {!anyKeyNeeded ? (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--paper-card)",
                    border: "1.5px dashed var(--ink)",
                    borderRadius: "3px",
                    fontSize: "0.85rem",
                    color: "var(--ink)",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--sage)" }}>100% Offline Setup: </span>
                  Both Story Analysis ({config.llm.provider}) and Voice ({config.tts.provider}) are set to local/offline providers. No cloud API keys required!
                </div>
              ) : (
                <>
                  {needsGeminiKey && (
                    <div style={{ marginBottom: "10px" }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span>Gemini API Key</span>
                        {setupStatus?.gemini_key_present || geminiKey.trim() ? (
                          <span style={{ color: "#155724", display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "0.75rem", fontWeight: 600 }}>
                            <CheckIcon size={13} /> Stored in Keychain
                          </span>
                        ) : (
                          <span style={{ color: "var(--rust)", fontSize: "0.75rem", fontWeight: 600 }}>(Key required for Gemini)</span>
                        )}
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          type={showGeminiKey ? "text" : "password"}
                          placeholder={setupStatus?.gemini_key_present ? "•••••••••••••••• (Stored in Keychain)" : "Paste Gemini API Key"}
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          aria-label="Gemini API Key"
                          autoComplete="off"
                          spellCheck="false"
                        />
                        <button
                          type="button"
                          className="password-toggle-btn"
                          onClick={() => setShowGeminiKey(!showGeminiKey)}
                          title={showGeminiKey ? "Hide API key" : "Show API key"}
                          aria-label={showGeminiKey ? "Hide API key" : "Show API key"}
                        >
                          {showGeminiKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {needsElevenlabsKey && (
                    <div style={{ marginBottom: "10px" }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span>ElevenLabs API Key</span>
                        {setupStatus?.elevenlabs_key_present || elevenlabsKey.trim() ? (
                          <span style={{ color: "#155724", display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "0.75rem", fontWeight: 600 }}>
                            <CheckIcon size={13} /> Stored in Keychain
                          </span>
                        ) : (
                          <span style={{ color: "var(--rust)", fontSize: "0.75rem", fontWeight: 600 }}>(Key required for ElevenLabs)</span>
                        )}
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          type={showElevenlabsKey ? "text" : "password"}
                          placeholder={setupStatus?.elevenlabs_key_present ? "•••••••••••••••• (Stored in Keychain)" : "Paste ElevenLabs API Key"}
                          value={elevenlabsKey}
                          onChange={(e) => setElevenlabsKey(e.target.value)}
                          aria-label="ElevenLabs API Key"
                          autoComplete="off"
                          spellCheck="false"
                        />
                        <button
                          type="button"
                          className="password-toggle-btn"
                          onClick={() => setShowElevenlabsKey(!showElevenlabsKey)}
                          title={showElevenlabsKey ? "Hide API key" : "Show API key"}
                          aria-label={showElevenlabsKey ? "Hide API key" : "Show API key"}
                        >
                          {showElevenlabsKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Section 4: Kokoro Offline Voice Assets (Only shown when Kokoro is selected) */}
        {config.tts.provider === "kokoro" && (
        <div
          style={{
            padding: "12px",
            background: "var(--paper-card)",
            border: "1.5px dashed var(--ink)",
            borderRadius: "3px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
              Kokoro Offline Voice Files (142 MB)
            </span>
            <span style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "4px" }}>
              {setupStatus?.kokoro_model_present && setupStatus?.kokoro_voices_present ? (
                <span style={{ color: "#155724", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "3px" }}>
                  <CheckIcon size={13} /> Ready on disk
                </span>
              ) : (
                <span style={{ color: "var(--rust)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "3px" }}>
                  <WarningIcon size={13} /> Not downloaded
                </span>
              )}
            </span>
          </div>

          <p style={{ fontSize: "0.78rem", color: "#666", margin: "0 0 10px 0" }}>
            Required for local text-to-speech without internet connection.
          </p>

          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: "0.8rem", width: "100%" }}
            onClick={handleDownloadKokoro}
            disabled={downloadingKokoro}
          >
            {downloadingKokoro
              ? `Downloading Kokoro Assets (${kokoroProgress ?? 0}%)...`
              : setupStatus?.kokoro_model_present && setupStatus?.kokoro_voices_present
              ? "Re-download Kokoro Assets"
              : "Download Kokoro Assets"}
          </button>

          {/* Live Progress Bar */}
          {kokoroProgress !== null && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: "4px" }}>
                <span style={{ fontFamily: "var(--font-sans)", color: "var(--ink)" }}>
                  {kokoroMessage || "Downloading voice assets..."}
                </span>
                <span style={{ fontWeight: "bold" }}>{kokoroProgress}%</span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#e5dac4",
                  border: "1px solid var(--ink)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${kokoroProgress}%`,
                    height: "100%",
                    background: "var(--rust)",
                    transition: "width 0.25s ease-in-out",
                  }}
                />
              </div>
            </div>
          )}
        </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving || downloadingKokoro}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={handleSaveConfig} disabled={saving || downloadingKokoro}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};
