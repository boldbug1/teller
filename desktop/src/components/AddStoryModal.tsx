import React, { useRef, useState } from "react";
import { api } from "../api/client";
import { FileIcon, TrashIcon, UploadCloudIcon } from "./Icons";

interface AddStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoryCreated: (storyId: string) => void;
}

interface SelectedFile {
  name: string;
  size?: number;
  base64?: string;
  path?: string;
}

export const AddStoryModal: React.FC<AddStoryModalProps> = ({
  isOpen,
  onClose,
  onStoryCreated,
}) => {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        // Base64 string from data URL
        const base64Data = result.includes(",") ? result.split(",")[1] : result;
        setSelectedFile({
          name: file.name,
          size: file.size,
          base64: base64Data,
        });
      }
    };
    reader.onerror = () => {
      setError("Failed to read the selected file.");
    };
    reader.readAsDataURL(file);
  };

  const handleNativeBrowse = async () => {
    setError(null);
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [
            {
              name: "Story Documents",
              extensions: ["pdf", "docx", "md", "txt", "markdown"],
            },
          ],
        });
        if (selected && typeof selected === "string") {
          const name = selected.split(/[\\/]/).pop() || selected;
          setSelectedFile({
            name,
            path: selected,
          });
          return;
        }
      } catch (err) {
        console.warn("Tauri dialog error, falling back to input", err);
      }
    }
    // Fallback to HTML file input
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !text.trim()) {
      setError("Please choose a story file (PDF, Word, MD, TXT) or paste your text.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (selectedFile) {
        const summary = await api.uploadStoryFile({
          name: selectedFile.name,
          base64: selectedFile.base64,
          path: selectedFile.path,
        });
        onStoryCreated(summary.story_id);
      } else {
        const summary = await api.pasteStory(text.trim());
        onStoryCreated(summary.story_id);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add story");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-story-title">
      <div className="modal-dialog">
        <h2 id="add-story-title" className="modal-title">
          Add Story
        </h2>
        <p style={{ fontSize: "0.82rem", color: "#666", marginTop: "-6px", marginBottom: "14px" }}>
          Upload a file or paste your story. The title and characters are detected automatically.
        </p>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "#f8d7da",
              border: "1px solid #f5c6cb",
              color: "#721c24",
              marginBottom: "14px",
              borderRadius: "2px",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* File Upload Zone */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".pdf,.docx,.doc,.md,.markdown,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChange(file);
            }}
          />

          {!selectedFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileChange(file);
              }}
              onClick={handleNativeBrowse}
              style={{
                border: `2px dashed ${dragActive ? "var(--rust)" : "var(--ink)"}`,
                borderRadius: "4px",
                padding: "24px 16px",
                textAlign: "center",
                background: dragActive ? "var(--paper-deep)" : "var(--paper-card)",
                cursor: "pointer",
                marginBottom: "16px",
                transition: "all 0.15s ease",
              }}
            >
              <UploadCloudIcon size={32} style={{ color: "var(--rust)", marginBottom: "6px" }} />
              <div style={{ fontWeight: "bold", fontSize: "0.95rem", marginBottom: "4px" }}>
                Choose or drop a story file
              </div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                Supports <strong>PDF, Word (.docx), Markdown (.md), or Plain Text (.txt)</strong>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "var(--paper-deep)",
                border: "1.5px solid var(--ink)",
                borderRadius: "3px",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <FileIcon size={24} style={{ color: "var(--rust)" }} />
                <div>
                  <div style={{ fontWeight: "bold", fontSize: "0.92rem" }}>
                    {selectedFile.name}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#666" }}>
                    {selectedFile.size ? `${Math.round(selectedFile.size / 1024)} KB • ` : ""}
                    Ready to import
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                title="Remove file"
                aria-label="Remove file"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--rust)",
                  padding: "4px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <TrashIcon size={16} />
              </button>
            </div>
          )}

          {/* Or Paste Text Directly */}
          {!selectedFile && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "10px 0" }}>
                <hr style={{ flex: 1, borderColor: "#ccc" }} />
                <span style={{ fontSize: "0.75rem", color: "#777", textTransform: "uppercase", fontWeight: "bold" }}>
                  Or paste text
                </span>
                <hr style={{ flex: 1, borderColor: "#ccc" }} />
              </div>

              <textarea
                rows={6}
                placeholder="Paste story text here (e.g. Chapter 1: The Monkey's Paw...)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ width: "100%", marginBottom: "16px" }}
              />
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || (!selectedFile && !text.trim())}
            >
              {loading ? "Adding Story..." : "Add Story"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
