import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { CloseIcon, FileIcon, TrashIcon, UploadCloudIcon } from "./Icons";
import { useDialog } from "./useDialog";

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

const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "md", "markdown", "txt"]);

export const AddStoryModal: React.FC<AddStoryModalProps> = ({ isOpen, onClose, onStoryCreated }) => {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialog(isOpen, onClose, !loading);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedFile(null);
    setText("");
    setError(null);
    setDragActive(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [isOpen]);

  if (!isOpen) return null;

  const readBrowserFile = (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      setError("Choose a PDF, DOCX, Markdown, or plain-text file.");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSelectedFile({
        name: file.name,
        size: file.size,
        base64: reader.result.includes(",") ? reader.result.split(",")[1] : reader.result,
      });
    };
    reader.onerror = () => setError("The selected file could not be read.");
    reader.readAsDataURL(file);
  };

  const handleNativeBrowse = async () => {
    setError(null);
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [{
            name: "Story documents",
            extensions: ["pdf", "docx", "md", "txt", "markdown"],
          }],
        });
        if (selected === null) return;
        if (typeof selected === "string") {
          setSelectedFile({ name: selected.split(/[\\/]/).pop() || selected, path: selected });
          return;
        }
      } catch (dialogError) {
        console.warn("Native file dialog unavailable", dialogError);
      }
    }
    fileInputRef.current?.click();
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFile && !text.trim()) {
      setError("Choose a story file or paste the story text.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const summary = selectedFile
        ? await api.uploadStoryFile(selectedFile)
        : await api.pasteStory(text.trim());
      onStoryCreated(summary.story_id);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The story could not be added.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-dialog add-story-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-story-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id="add-story-title" className="modal-title">Add a Story</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={loading} aria-label="Close add story">
            <CloseIcon size={15} />
          </button>
        </div>
        <p className="modal-intro">Import a file or paste text. Teller will detect the title, characters, and dialogue.</p>

        {error ? <div className="form-alert error" role="alert">{error}</div> : null}

        <form onSubmit={handleSubmit}>
          <input
            className="file-input-hidden"
            type="file"
            ref={fileInputRef}
            accept=".pdf,.docx,.md,.markdown,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readBrowserFile(file);
            }}
          />

          {!selectedFile ? (
            <button
              type="button"
              className={`upload-dropzone ${dragActive ? "is-dragging" : ""}`}
              onClick={handleNativeBrowse}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) readBrowserFile(file);
              }}
            >
              <UploadCloudIcon size={30} />
              <strong>Choose or drop a story file</strong>
              <span>PDF, DOCX, Markdown, or plain text</span>
            </button>
          ) : (
            <div className="selected-file-card">
              <span className="selected-file-icon"><FileIcon size={21} /></span>
              <span className="selected-file-copy">
                <strong>{selectedFile.name}</strong>
                <span>{selectedFile.size ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB / ` : ""}Ready to import</span>
              </span>
              <button type="button" className="remove-file-btn" onClick={clearSelectedFile} aria-label="Remove file">
                <TrashIcon size={15} />
              </button>
            </div>
          )}

          {!selectedFile ? (
            <>
              <div className="form-divider"><span>or paste text</span></div>
              <label className="sr-only" htmlFor="story-text">Story text</label>
              <textarea
                id="story-text"
                className="story-textarea"
                rows={7}
                placeholder="Once upon a time..."
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || (!selectedFile && !text.trim())}>
              {loading ? "Adding story..." : "Add to Library"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
