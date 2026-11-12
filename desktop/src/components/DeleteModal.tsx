import React from "react";
import { CloseIcon, TrashIcon } from "./Icons";
import { useDialog } from "./useDialog";

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
  const dialogRef = useDialog(isOpen, onClose, !loading);
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <span className="section-kicker">Confirmation</span>
            <h2 id="delete-title" className="modal-title">Delete Story</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={loading} aria-label="Close delete confirmation">
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="delete-warning-icon" aria-hidden="true"><TrashIcon size={22} /></div>
        <p id="delete-description" className="delete-description">
          Delete <strong>"{storyTitle}"</strong>? Its text, characters, and generated audio will be removed permanently.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
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
