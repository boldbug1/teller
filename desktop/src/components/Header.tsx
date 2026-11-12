import React, { useState } from "react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { SetupStatus } from "../types";
import {
  DoctorIcon,
  SettingsIcon,
  WinCloseIcon,
  WinMaximizeIcon,
  WinMinimizeIcon,
  WinRestoreIcon,
} from "./Icons";

interface HeaderProps {
  setupStatus: SetupStatus | null;
  onOpenSettings: () => void;
  onOpenDoctor: () => void;
}

const getTauriWindow = async (): Promise<TauriWindow | null> => {
  try {
    if (typeof window === "undefined") return null;
    const { isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) return null;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch (error) {
    console.warn("Tauri window API is unavailable", error);
  }
  return null;
};

const runWindowCommand = async (command: (window: TauriWindow) => Promise<void>) => {
  try {
    const appWindow = await getTauriWindow();
    if (appWindow) await command(appWindow);
  } catch (error) {
    console.warn("Window command failed", error);
  }
};

export const Header: React.FC<HeaderProps> = React.memo(function Header({
  setupStatus: _setupStatus,
  onOpenSettings,
  onOpenDoctor,
}) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = async () => {
    await runWindowCommand((appWindow) => appWindow.minimize());
  };

  const handleToggleMaximize = async () => {
    await runWindowCommand(async (appWindow) => {
      await appWindow.toggleMaximize();
      setIsMaximized((maximized) => !maximized);
    });
  };

  const handleClose = async () => {
    await runWindowCommand((appWindow) => appWindow.close());
  };

  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="brand-section" data-tauri-drag-region>
        <img
          src="/logo.svg"
          alt="Teller Logo"
          className="app-header-logo"
        />
        <div className="brand-title-group" data-tauri-drag-region>
          <h1 className="brand-title">Teller</h1>
        </div>
      </div>

      <div className="header-drag-spacer" data-tauri-drag-region />

      <div className="header-actions">
        <button
          type="button"
          className="header-icon-btn"
          onClick={onOpenDoctor}
          title="Diagnostics: Check LLM & TTS providers"
          aria-label="Diagnostics"
        >
          <DoctorIcon size={17} />
          <span className="sr-only">Diagnostics</span>
        </button>
        <button
          type="button"
          className="header-icon-btn"
          onClick={onOpenSettings}
          title="Settings: Configure voice models, API keys, and providers"
          aria-label="Settings"
        >
          <SettingsIcon size={17} />
          <span className="sr-only">Settings</span>
        </button>

        <div className="windows-titlebar-controls" aria-label="Window Management">
          <button
            type="button"
            className="win-ctl-btn win-ctl-min"
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize"
          >
            <WinMinimizeIcon size={10} />
          </button>
          <button
            type="button"
            className="win-ctl-btn win-ctl-max"
            onClick={handleToggleMaximize}
            title={isMaximized ? "Restore Down" : "Maximize"}
            aria-label={isMaximized ? "Restore Down" : "Maximize"}
          >
            {isMaximized ? <WinRestoreIcon size={10} /> : <WinMaximizeIcon size={10} />}
          </button>
          <button
            type="button"
            className="win-ctl-btn win-ctl-close"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
          >
            <WinCloseIcon size={10} />
          </button>
        </div>
      </div>
    </header>
  );
});
