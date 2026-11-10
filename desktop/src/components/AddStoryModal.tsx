import React, { useState } from "react";
import { api } from "../api/client";

interface AddStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoryCreated: (storyId: string) => void;
}

export const AddStoryModal: React.FC<AddStoryModalProps> = ({
  isOpen,
  onClose,
  onStoryCreated,
}) => {
  const [tab, setTab] = useState<"paste" | "import">("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("Please paste story text.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const summary = await api.pasteStory(text, title.trim() || undefined);
      onStoryCreated(summary.story_id);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save story");
    } finally {
      setLoading(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath.trim()) {
      setError("Please select or enter a file path.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const summary = await api.importStory(filePath.trim(), title.trim() || undefined);
      onStoryCreated(summary.story_id);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to import story");
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseFile = async () => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [{ name: "Text Files", extensions: ["txt", "md"] }],
        });
        if (selected && typeof selected === "string") {
          setFilePath(selected);
        }
      } catch (err) {
        console.warn("Tauri file dialog error", err);
      }
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-dialog">
        <h2 id="modal-title" className="modal-title">Add Story</h2>

        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <button
            type="button"
            className="btn-secondary"
            style={{
              flex: 1,
              background: tab === "paste" ? "var(--rust)" : "var(--paper-card)",
              color: tab === "paste" ? "#fff" : "inherit",
            }}
            onClick={() => setTab("paste")}
          >
            Paste Text
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{
              flex: 1,
              background: tab === "import" ? "var(--rust)" : "var(--paper-card)",
              color: tab === "import" ? "#fff" : "inherit",
            }}
            onClick={() => setTab("import")}
          >
            Import File
          </button>
        </div>

        {error && (
          <div style={{ padding: "8px 12px", background: "#f8d7da", border: "1px solid #f5c6cb", color: "#721c24", marginBottom: "14px", borderRadius: "2px", fontSize: "0.85rem" }}>
            {error}
          </div>
        )}

        {tab === "paste" ? (
          <form onSubmit={handlePasteSubmit}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: "bold" }}>
              Story Title (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. The Monkey's Paw"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: "bold" }}>
              Story Text
            </label>
            <textarea
              rows={8}
              placeholder="Paste plain text story here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Adding..." : "Add Story"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleImportSubmit}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: "bold" }}>
              Story Title (optional)
            </label>
            <input
              type="text"
              placeholder="Override title (defaults to filename)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: "bold" }}>
              File Path
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="C:\path\to\story.txt"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleBrowseFile}
                style={{ height: "40px", whiteSpace: "nowrap" }}
              >
                Browse...
              </button>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Importing..." : "Import File"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

