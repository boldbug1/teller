import React from "react";
import { SetupStatus } from "../types";

interface HeaderProps {
  setupStatus: SetupStatus | null;
  onOpenSettings: () => void;
  onOpenDoctor: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  setupStatus,
  onOpenSettings,
  onOpenDoctor,
}) => {
  const isReady = setupStatus?.ready ?? false;

  return (
    <header className="app-header">
      <div className="brand-section">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <circle cx="14" cy="14" r="12" stroke="var(--ink)" strokeWidth="2" fill="var(--paper-deep)" />
          <path d="M10 8l10 6-10 6V8z" fill="var(--rust)" />
        </svg>
        <h1 className="brand-title">Teller</h1>
        <div
          className="header-status-pill"
          title={isReady ? "Ready for synthesis" : "Setup required"}
          role="status"
        >
          <span className={`status-dot ${isReady ? "" : "needs-setup"}`} />
          <span>{isReady ? "Ready" : "Setup Required"}</span>
        </div>
      </div>

      <div className="header-actions">
        <button
          className="header-btn"
          onClick={onOpenDoctor}
          title="Run diagnostics on providers and audio"
          aria-label="Doctor checks"
        >
          🩺 Doctor
        </button>
        <button
          className="header-btn"
          onClick={onOpenSettings}
          title="Configure providers and API keys"
          aria-label="Settings"
        >
          ⚙️ Settings
        </button>
      </div>
    </header>
  );
};

