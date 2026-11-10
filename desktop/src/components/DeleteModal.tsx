import React from "react";

interface DeleteModalProps {
  isOpen: boolean;
  storyTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
  isOpen,
  storyTitle,
  onClose,
  onConfirm,
  loading = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="modal-dialog" style={{ maxWidth: "440px" }}>
        <h2 id="delete-title" className="modal-title" style={{ color: "var(--rust)" }}>
          Delete Story
        </h2>
        <p style={{ margin: "14px 0", lineHeight: 1.5 }}>
          Are you sure you want to delete <strong>"{storyTitle}"</strong>? This will remove the story text, character cast, and all rendered audio files.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ background: "var(--rust)" }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
};

