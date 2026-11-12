import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { SetupStatus } from "../types";
import { CheckIcon, CloseIcon, EyeIcon, EyeOffIcon, SettingsIcon, WarningIcon } from "./Icons";
import { useDialog } from "./useDialog";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setupStatus: SetupStatus | null;
  onRefreshStatus: () => void;
}

const GEMINI_LLM_MODELS = [
  { value: "gemini-3.8-flash", label: "gemini-3.8-flash (Recommended)" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash (Standard)" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro (In-depth analysis)" },
];

const GROQ_LLM_MODELS = [
  { value: "llama-3.3-70b-versatile", label: "llama-3.3-70b-versatile (Recommended)" },
  { value: "llama-3.1-8b-instant", label: "llama-3.1-8b-instant (Fastest)" },
  { value: "mixtral-8x7b-32768", label: "mixtral-8x7b-32768 (32k Context)" },
];

const OLLAMA_DEFAULT_MODELS = [
  "llama3.2",
  "mistral",
  "qwen2.5",
  "phi3",
  "gemma2",
];

const ELEVENLABS_MODELS = [
  { value: "eleven_multilingual_v2", label: "eleven_multilingual_v2 (Recommended)" },
  { value: "eleven_turbo_v2_5", label: "eleven_turbo_v2_5 (Low Latency)" },
  { value: "eleven_flash_v2_5", label: "eleven_flash_v2_5 (Ultra Fast)" },
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
  const [groqKey, setGroqKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [showElevenlabsKey, setShowElevenlabsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingKokoro, setDownloadingKokoro] = useState(false);
  const [kokoroProgress, setKokoroProgress] = useState<number | null>(null);
  const [kokoroMessage, setKokoroMessage] = useState<string>("");
  const [customLlmModel, setCustomLlmModel] = useState(false);
  const [customTtsModel, setCustomTtsModel] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savedKeys, setSavedKeys] = useState({ gemini: false, groq: false, elevenlabs: false });
  const pollGenerationRef = useRef(0);
  const dialogRef = useDialog(isOpen, onClose, !saving && !downloadingKokoro);

  useEffect(() => {
    if (!isOpen) {
      pollGenerationRef.current += 1;
      return;
    }

    let cancelled = false;
    setConfig(null);
    setLoadingConfig(true);
    setLoadError(null);
    setMsg(null);
    setGeminiKey("");
    setGroqKey("");
    setElevenlabsKey("");
    setShowGeminiKey(false);
    setShowGroqKey(false);
    setShowElevenlabsKey(false);
    setDownloadingKokoro(false);
    setKokoroProgress(null);
    setSavedKeys({
      gemini: Boolean(setupStatus?.gemini_key_present),
      groq: Boolean(setupStatus?.groq_key_present),
      elevenlabs: Boolean(setupStatus?.elevenlabs_key_present),
    });

    api.getConfig().then((cfg) => {
      if (cancelled) return;
        setConfig(cfg);
        const knownLlmModels = cfg.llm.provider === "gemini"
          ? GEMINI_LLM_MODELS.map((model) => model.value)
          : cfg.llm.provider === "groq"
            ? GROQ_LLM_MODELS.map((model) => model.value)
            : [...OLLAMA_DEFAULT_MODELS, ...(setupStatus?.ollama_models || [])];
        setCustomLlmModel(
          cfg.llm.provider !== "rule_based" && !knownLlmModels.includes(cfg.llm.model)
        );
        setCustomTtsModel(
          cfg.tts.provider === "elevenlabs" && !ELEVENLABS_MODELS.some((model) => model.value === cfg.tts.model)
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Settings could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });

    return () => {
      cancelled = true;
      pollGenerationRef.current += 1;
    };
  }, [isOpen, loadAttempt]);

  if (!isOpen) return null;

  if (!config) {
    return (
      <div className="modal-overlay">
        <div
          ref={dialogRef}
          className="modal-dialog settings-modal-dialog settings-loading-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          tabIndex={-1}
        >
          <div className="settings-header">
            <div className="settings-header-title">
              <SettingsIcon size={18} className="settings-header-icon" />
              <h2 id="settings-title">Settings</h2>
            </div>
            <button type="button" className="settings-close-x" onClick={onClose} aria-label="Close settings">
              <CloseIcon size={14} />
            </button>
          </div>
          {loadingConfig ? (
            <div className="settings-loading-state" role="status">
              <span className="spinner-indicator" aria-hidden="true" />
              <strong>Opening the control room</strong>
              <span>Loading providers and local engine settings...</span>
            </div>
          ) : (
            <div className="settings-loading-state" role="alert">
              <WarningIcon size={22} />
              <strong>Settings are unavailable</strong>
              <span>{loadError || "The local service did not return its configuration."}</span>
              <button type="button" className="btn-secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try Again</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const handleSaveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.patchConfig(config);
      const secretUpdates = [
        ["gemini", geminiKey.trim()],
        ["groq", groqKey.trim()],
        ["elevenlabs", elevenlabsKey.trim()],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]));
      await Promise.all(secretUpdates.map(([provider, key]) => api.setSecret(provider, key)));
      const keySavedCount = secretUpdates.length;
      setSavedKeys((current) => ({
        ...current,
        ...Object.fromEntries(secretUpdates.map(([provider]) => [provider, true])),
      }));
      setGeminiKey("");
      setGroqKey("");
      setElevenlabsKey("");
      setShowGeminiKey(false);
      setShowGroqKey(false);
      setShowElevenlabsKey(false);
      onRefreshStatus();
      setMsg({
        text: keySavedCount > 0
          ? `Settings & ${keySavedCount} key${keySavedCount > 1 ? "s" : ""} saved to Keychain!`
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
    const generation = ++pollGenerationRef.current;
    setDownloadingKokoro(true);
    setKokoroProgress(0);
    setKokoroMessage("Initiating download...");
    try {
      const res = await api.downloadKokoroAssets();
      const opId = res.operation_id;
      let consecutiveFailures = 0;

      while (pollGenerationRef.current === generation) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (pollGenerationRef.current !== generation) return;
        try {
          const op = await api.getOperation(opId);
          consecutiveFailures = 0;
          if (op.total > 0) {
            setKokoroProgress(Math.min(100, Math.round((op.completed / op.total) * 100)));
          }
          if (op.message_code) setKokoroMessage(op.message_code.replace(/_/g, " "));
          if (op.state === "completed") {
            setKokoroProgress(100);
            setKokoroMessage("Kokoro voice assets ready");
            setDownloadingKokoro(false);
            onRefreshStatus();
            setMsg({ text: "Kokoro offline voice assets are ready.", type: "success" });
            return;
          }
          if (op.state === "failed" || op.state === "cancelled") {
            setDownloadingKokoro(false);
            setKokoroProgress(null);
            setMsg({ text: `Download ${op.state}: ${op.error || op.message_code}`, type: "error" });
            return;
          }
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 5) throw new Error("Lost contact with the asset download.");
        }
      }
    } catch (err: any) {
      if (pollGenerationRef.current === generation) {
        setDownloadingKokoro(false);
        setKokoroProgress(null);
        setMsg({ text: err.message || "Failed to start download", type: "error" });
      }
    }
  };

  const handleDeleteSecret = async (provider: "gemini" | "groq" | "elevenlabs") => {
    setSaving(true);
    setMsg(null);
    try {
      await api.deleteSecret(provider);
      setSavedKeys((current) => ({ ...current, [provider]: false }));
      onRefreshStatus();
      setMsg({ text: `${provider[0].toUpperCase() + provider.slice(1)} key removed from Keychain.`, type: "success" });
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : "The key could not be removed.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const ollamaOptions = Array.from(
    new Set([...(setupStatus?.ollama_models || []), ...OLLAMA_DEFAULT_MODELS])
  );

  const needsGeminiKey = config.llm.provider === "gemini" || config.tts.provider === "gemini";
  const needsGroqKey = config.llm.provider === "groq";
  const needsElevenlabsKey = config.tts.provider === "elevenlabs";
  const anyKeyNeeded = needsGeminiKey || needsGroqKey || needsElevenlabsKey;
  const kokoroAssetsPresent = Boolean(
    setupStatus?.kokoro_model_present && setupStatus?.kokoro_voices_present
  );
  const kokoroReady = Boolean(
    kokoroAssetsPresent && setupStatus?.kokoro_runtime_available
  );

  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-dialog settings-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="settings-header">
          <div className="settings-header-title">
            <SettingsIcon size={18} className="settings-header-icon" />
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            type="button"
            className="settings-close-x"
            onClick={onClose}
            disabled={saving || downloadingKokoro}
            title="Close"
            aria-label="Close settings"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {msg && (
          <div className={`settings-alert-banner ${msg.type}`} role={msg.type === "error" ? "alert" : "status"}>
            {msg.text}
          </div>
        )}

        {/* Section 1: Side-by-Side Engines Grid */}
        <div className="settings-engines-grid">
          {/* Engine Column 1: Story Analysis */}
          <div className="settings-card-panel">
            <div className="settings-panel-header">
              <span className="settings-panel-title">Story Analysis</span>
            </div>

            <div className="settings-row-compact">
              <label className="settings-label" htmlFor="llm-provider">Provider</label>
              <select
                id="llm-provider"
                className="settings-select"
                value={config.llm.provider}
                onChange={(e) => {
                  const prov = e.target.value;
                  const defModel = prov === "gemini"
                    ? "gemini-3.8-flash"
                    : prov === "groq"
                    ? "llama-3.3-70b-versatile"
                    : prov === "rule_based"
                    ? "builtin"
                    : (setupStatus?.ollama_models?.[0] || "llama3.2");
                  setCustomLlmModel(false);
                  setConfig({
                    ...config,
                    llm: { ...config.llm, provider: prov, model: defModel },
                  });
                }}
              >
                <option value="groq">Groq (Ultra-Fast Cloud - Free Tier)</option>
                <option value="gemini">Gemini (Google Cloud AI)</option>
                <option value="rule_based">Rule-Based (100% Offline & Free)</option>
                <option value="ollama">Ollama (Local AI / Offline)</option>
              </select>
            </div>

            <div className="settings-row-compact">
              <label className="settings-label" htmlFor="llm-model">Model</label>
              {config.llm.provider === "rule_based" ? (
                <input
                  id="llm-model"
                  type="text"
                  className="settings-input"
                  disabled
                  value="Built-in Dialogue & Cast Parser"
                />
              ) : config.llm.provider === "groq" ? (
                <>
                  <select
                    id="llm-model"
                    className="settings-select"
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
                    {GROQ_LLM_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    <option value="custom">Custom model name...</option>
                  </select>
                  {customLlmModel && (
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g. llama-3.3-70b-versatile"
                      value={config.llm.model}
                      style={{ marginTop: "4px" }}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          llm: { ...config.llm, model: e.target.value },
                        })
                      }
                    />
                  )}
                </>
              ) : config.llm.provider === "gemini" ? (
                <>
                  <select
                    id="llm-model"
                    className="settings-select"
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
                    <option value="custom">Custom model...</option>
                  </select>
                  {customLlmModel && (
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="Enter Gemini model name"
                      value={config.llm.model}
                      style={{ marginTop: "4px" }}
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
                    id="llm-model"
                    className="settings-select"
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
                    <option value="custom">Custom model...</option>
                  </select>
                  {customLlmModel && (
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="Enter Ollama model name"
                      value={config.llm.model}
                      style={{ marginTop: "4px" }}
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

          {/* Engine Column 2: Voice & Speech */}
          <div className="settings-card-panel">
            <div className="settings-panel-header">
              <span className="settings-panel-title">Voice & Speech (TTS)</span>
              
            </div>

            <div className="settings-row-compact">
              <label className="settings-label" htmlFor="tts-provider">Voice Provider</label>
              <select
                id="tts-provider"
                className="settings-select"
                value={config.tts.provider}
                onChange={(e) => {
                  const prov = e.target.value;
                  let defModel = "eleven_multilingual_v2";
                  if (prov === "kokoro") defModel = "kokoro-v1.0-int8";
                  if (prov === "gemini") defModel = "gemini-3.8-flash-lite-tts";
                  setCustomTtsModel(false);
                  setConfig({
                    ...config,
                    tts: { ...config.tts, provider: prov, model: defModel },
                  });
                }}
              >
                <option value="elevenlabs">ElevenLabs (High-Realism Cloud)</option>
                <option value="kokoro">Kokoro (100% Offline / Local)</option>
                <option value="gemini">Gemini (Cloud)</option>
              </select>
            </div>

            <div className="settings-row-compact">
              <label className="settings-label" htmlFor="tts-model">Voice Model</label>
              {config.tts.provider === "elevenlabs" ? (
                <>
                  <select
                    id="tts-model"
                    className="settings-select"
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
                      className="settings-input"
                      placeholder="Enter model name"
                      value={config.tts.model}
                      style={{ marginTop: "4px" }}
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
                <input
                  id="tts-model"
                  type="text"
                  className="settings-input"
                  disabled
                  value="kokoro-v1.0-int8 (Built-in offline)"
                />
              ) : (
                <input
                  id="tts-model"
                  type="text"
                  className="settings-input"
                  disabled
                  value="gemini-3.8-flash-lite-tts (Standard)"
                />
              )}
            </div>
          </div>
        </div>

        {/* Section 2: API Keys Card (Compact 2-Column Grid) */}
        <div className="settings-card-panel" style={{ padding: "12px 14px" }}>
          <div className="settings-panel-header" style={{ marginBottom: "10px" }}>
            <span className="settings-panel-title">API Credentials</span>
          </div>

          {!anyKeyNeeded ? (
            <div className="settings-offline-pill">
              <CheckIcon size={14} style={{ color: "#15803d" }} />
              <span>
                <strong>100% Offline:</strong> Local AI & Kokoro selected. No cloud API keys needed.
              </span>
            </div>
          ) : (
            <div className="settings-keys-grid">
              {needsGroqKey && (
                <div className="settings-key-block">
                  <div className="settings-key-head">
                    <label className="settings-label" htmlFor="groq-api-key">Groq API Key</label>
                    <div className="key-status-actions">
                      {savedKeys.groq ? (
                        <span className="keychain-badge stored"><CheckIcon size={12} /> In Keychain</span>
                      ) : (
                        <span className="keychain-badge missing">Key required</span>
                      )}
                      {savedKeys.groq ? (
                        <button type="button" className="remove-secret-btn" onClick={() => void handleDeleteSecret("groq")}>Remove</button>
                      ) : null}
                    </div>
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      id="groq-api-key"
                      className="settings-input"
                      type={showGroqKey ? "text" : "password"}
                      placeholder={savedKeys.groq ? "Stored in Keychain (enter to replace)" : "Paste Groq API Key (gsk_...)"}
                      value={groqKey}
                      onChange={(e) => setGroqKey(e.target.value)}
                      aria-label="Groq API Key"
                      autoComplete="off"
                      spellCheck="false"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowGroqKey(!showGroqKey)}
                      title={showGroqKey ? "Hide key" : "Show key"}
                      aria-label={showGroqKey ? "Hide key" : "Show key"}
                    >
                      {showGroqKey ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  </div>
                </div>
              )}

              {needsElevenlabsKey && (
                <div className="settings-key-block">
                  <div className="settings-key-head">
                    <label className="settings-label" htmlFor="elevenlabs-api-key">ElevenLabs API Key</label>
                    <div className="key-status-actions">
                      {savedKeys.elevenlabs ? (
                        <span className="keychain-badge stored"><CheckIcon size={12} /> In Keychain</span>
                      ) : (
                        <span className="keychain-badge missing">Key required</span>
                      )}
                      {savedKeys.elevenlabs ? (
                        <button type="button" className="remove-secret-btn" onClick={() => void handleDeleteSecret("elevenlabs")}>Remove</button>
                      ) : null}
                    </div>
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      id="elevenlabs-api-key"
                      className="settings-input"
                      type={showElevenlabsKey ? "text" : "password"}
                      placeholder={savedKeys.elevenlabs ? "Stored in Keychain (enter to replace)" : "Paste ElevenLabs API Key"}
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
                      title={showElevenlabsKey ? "Hide key" : "Show key"}
                      aria-label={showElevenlabsKey ? "Hide key" : "Show key"}
                    >
                      {showElevenlabsKey ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  </div>
                </div>
              )}

              {needsGeminiKey && (
                <div className="settings-key-block">
                  <div className="settings-key-head">
                    <label className="settings-label" htmlFor="gemini-api-key">Gemini API Key</label>
                    <div className="key-status-actions">
                      {savedKeys.gemini ? (
                        <span className="keychain-badge stored"><CheckIcon size={12} /> In Keychain</span>
                      ) : (
                        <span className="keychain-badge missing">Key required</span>
                      )}
                      {savedKeys.gemini ? (
                        <button type="button" className="remove-secret-btn" onClick={() => void handleDeleteSecret("gemini")}>Remove</button>
                      ) : null}
                    </div>
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      id="gemini-api-key"
                      className="settings-input"
                      type={showGeminiKey ? "text" : "password"}
                      placeholder={savedKeys.gemini ? "Stored in Keychain (enter to replace)" : "Paste Gemini API Key"}
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
                      title={showGeminiKey ? "Hide key" : "Show key"}
                      aria-label={showGeminiKey ? "Hide key" : "Show key"}
                    >
                      {showGeminiKey ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Kokoro Offline Voice Assets (When Kokoro is selected) */}
        {config.tts.provider === "kokoro" && (
          <div className="settings-card-panel kokoro-panel">
            <div className="kokoro-panel-head">
              <div>
                <span className="kokoro-panel-title">
                  Kokoro Offline Voice Files (142 MB)
                </span>
                <span className="kokoro-panel-subtitle">
                  For zero-latency local speech
                </span>
              </div>
              <span>
                {kokoroReady ? (
                  <span className="keychain-badge stored">
                    <CheckIcon size={12} /> Ready on disk
                  </span>
                ) : (
                  <span className="keychain-badge missing">
                    <WarningIcon size={12} />
                    {kokoroAssetsPresent ? "Runtime unavailable" : "Not downloaded"}
                  </span>
                )}
              </span>
            </div>

            <div className="kokoro-download-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDownloadKokoro}
                disabled={downloadingKokoro || (kokoroAssetsPresent && !kokoroReady)}
              >
                {downloadingKokoro
                  ? `${kokoroMessage || "Downloading Assets"} (${kokoroProgress ?? 0}%)`
                  : kokoroReady
                  ? "Re-download Assets"
                  : kokoroAssetsPresent
                  ? "Restart with latest build"
                  : "Download Voice Assets"}
              </button>

              {kokoroProgress !== null && (
                <div className="kokoro-progress">
                  <div
                    className="progress-bar-container"
                    role="progressbar"
                    aria-label="Kokoro download progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={kokoroProgress}
                  >
                    <div className="progress-fill" style={{ width: `${kokoroProgress}%` }} />
                  </div>
                  <strong>{kokoroProgress}%</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Actions Footer */}
        <div className="settings-footer-actions">
          <button
            type="button"
            className="settings-btn-cancel"
            onClick={onClose}
            disabled={saving || downloadingKokoro}
          >
            Close
          </button>
          <button
            type="button"
            className="settings-btn-save"
            onClick={handleSaveConfig}
            disabled={saving || downloadingKokoro}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};
