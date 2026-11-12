import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "../Header";

const windowCommands = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowCommands,
}));

describe("Header window controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards minimize, maximize, and close to the current Tauri window", async () => {
    render(
      <Header
        setupStatus={null}
        onOpenSettings={() => {}}
        onOpenDoctor={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(windowCommands.minimize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(windowCommands.toggleMaximize).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Restore Down" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(windowCommands.close).toHaveBeenCalledTimes(1));
  });
});
