// @vitest-environment jsdom
import type { ApplicationUpdateStateCapability } from "@termco/application-base";
import type { DesktopIntegrationCapability } from "@termco/desktop-base";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdaterDialog } from "./UpdaterDialog";
import type { UpdaterStatus } from "./types";

const state = {
  status: { kind: "idle" } as UpdaterStatus,
  install: vi.fn(async () => {}),
  dismiss: vi.fn(),
  check: vi.fn(async () => {}),
};
const desktop = {
  openUrl: vi.fn(async () => {}),
  writeClipboardText: vi.fn(),
} as unknown as DesktopIntegrationCapability;
const dependencies = {
  state: {} as ApplicationUpdateStateCapability,
  desktop,
};
const UpdaterDialog = createUpdaterDialog(dependencies, () => state);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const manualInfo = {
  version: "2.0.0",
  currentVersion: "1.0.0",
  body: "notes",
  releaseUrl: "https://github.com/termco-ai/termco/releases/tag/v2.0.0",
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  state.status = { kind: "idle" };
  state.install.mockClear();
  state.dismiss.mockClear();
  vi.mocked(desktop.openUrl).mockClear();
  vi.mocked(desktop.writeClipboardText).mockClear();
});

afterEach(cleanup);

describe("UpdaterDialog", () => {
  it("renders nothing for non-presented states", () => {
    for (const status of [
      { kind: "idle" },
      { kind: "checking" },
      { kind: "uptodate" },
      { kind: "error", message: "x" },
    ] as UpdaterStatus[]) {
      state.status = status;
      const { container } = render(<UpdaterDialog />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("offers install and later with exact release copy", () => {
    state.status = {
      kind: "available",
      update: {
        available: true,
        version: "3.1.0",
        currentVersion: "3.0.0",
        body: "changelog text",
      },
    };
    render(<UpdaterDialog />);
    expect(screen.getByText("Termco v3.1.0 is available")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("What’s new")).toBeDefined();
    expect(screen.getByText("changelog text")).toBeDefined();
    fireEvent.click(screen.getByText("Install & restart"));
    expect(state.install).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Later"));
    expect(state.dismiss).toHaveBeenCalled();
  });

  it("falls back to the established generic release description", () => {
    state.status = {
      kind: "available",
      update: {
        available: true,
        version: "3.1.0",
        currentVersion: "3.0.0",
        body: "",
      },
    };
    render(<UpdaterDialog />);
    fireEvent.click(screen.getByText("Review"));
    expect(
      screen.getByText("A new version is ready to install."),
    ).toBeDefined();
  });

  it("shows known and unknown download progress", () => {
    state.status = {
      kind: "downloading",
      downloaded: 512,
      contentLength: 1024,
    };
    const first = render(<UpdaterDialog />);
    expect(screen.getByText("Downloading update…")).toBeDefined();
    expect(screen.getByText("50% — 512 B")).toBeDefined();
    expect(document.querySelector("[data-slot=progress]")).not.toBeNull();
    first.unmount();

    state.status = {
      kind: "downloading",
      downloaded: 2048,
      contentLength: null,
    };
    render(<UpdaterDialog />);
    expect(screen.getByText("2.0 KB")).toBeDefined();
  });

  it("prompts for restart when ready", () => {
    state.status = { kind: "ready" };
    render(<UpdaterDialog />);
    expect(screen.getByText("Update ready")).toBeDefined();
    expect(
      screen.getByText("Restart Termco to finish installing."),
    ).toBeDefined();
  });

  it("preserves the Linux distro workflow and release action", () => {
    state.status = { kind: "manual-available", info: manualInfo };
    render(<UpdaterDialog />);
    expect(screen.getByText("Termco v2.0.0 is available")).toBeDefined();
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByText("What’s new")).toBeDefined();
    expect(screen.getByText("notes")).toBeDefined();
    expect(screen.getByText(/You're on v1\.0\.0/)).toBeDefined();
    expect(screen.getByText("$ yay -S termco-bin")).toBeDefined();
    fireEvent.click(screen.getByText("Debian / Ubuntu"));
    expect(
      screen.getByText("$ sudo apt install ./Termco_2.0.0_amd64.deb"),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Download package"));
    expect(desktop.openUrl).toHaveBeenCalledWith(manualInfo.releaseUrl);
  });

  it("copies the active Linux command through desktop.integration", async () => {
    state.status = { kind: "manual-available", info: manualInfo };
    render(<UpdaterDialog />);
    fireEvent.click(screen.getByText("Review"));
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => {
      expect(desktop.writeClipboardText).toHaveBeenCalledWith(
        "yay -S termco-bin",
      );
      expect(screen.getByText("Copied")).toBeDefined();
    });
  });

  it("announces plugin changes non-blockingly and keeps review actions visible", () => {
    state.status = {
      kind: "plugin-available",
      release: {
        releaseId: "plugins-2026.08.30.1",
        publishedAt: "2026-08-30T12:00:00.000Z",
        plugins: [
          {
            id: "preview-surface-native",
            name: "Preview Surface",
            currentVersion: "1.0.0",
            version: "1.1.0",
            notes: "Improves preview refresh behavior.",
          },
          {
            id: "markdown-surface",
            name: "Markdown Surface",
            currentVersion: null,
            version: "1.0.0",
            notes: "Adds markdown previews.",
          },
        ],
        skipped: [{
          id: "custom-native",
          name: "Custom Plugin",
          currentVersion: "1.0.0",
          version: "1.1.0",
          notes: "Publisher update.",
          reason: "A customized source is active, so this plugin was left untouched.",
        }],
      },
    };
    render(<UpdaterDialog />);
    expect(screen.getByRole("status").textContent).toContain(
      "2 plugin updates available",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByText("2 plugins ready to update")).toBeDefined();
    expect(screen.getByText("What’s new")).toBeDefined();
    expect(screen.getByTestId("plugin-release-scroll-region")).toBeDefined();
    expect(screen.getByTestId("update-dialog-footer")).toBeDefined();
    expect(screen.getByText("1.0.0 → 1.1.0")).toBeDefined();
    expect(screen.getByText("new → 1.0.0")).toBeDefined();
    expect(screen.getByText("Improves preview refresh behavior.")).toBeDefined();
    expect(screen.getByTestId("plugin-release-skipped")).toBeDefined();
    expect(screen.getByText("Custom Plugin")).toBeDefined();
    expect(screen.getByText("Customized")).toBeDefined();
    expect(screen.queryByText(/restart/i)).toBeNull();
    fireEvent.click(screen.getByText("Update plugins"));
    expect(state.install).toHaveBeenCalled();
  });

  it("shows real plugin installation progress above the scroll region", () => {
    state.status = {
      kind: "plugin-installing",
      release: {
        releaseId: "plugins-2026.08.30.1",
        publishedAt: "2026-08-30T12:00:00.000Z",
        plugins: [{
          id: "preview-surface-native",
          name: "Preview Surface",
          currentVersion: "1.0.0",
          version: "1.1.0",
          notes: "Improves preview refresh behavior.",
        }],
      },
      progress: {
        stage: "preparing",
        completed: 0,
        total: 1,
        pluginName: "Preview Surface",
      },
    };
    render(<UpdaterDialog />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("Preparing Preview Surface (1 of 1)"))
      .toBeDefined();
  });

  it("explains an automatic revoked-release rollback", () => {
    state.status = {
      kind: "plugin-rolled-back",
      releaseId: "plugins-2026.08.30.1",
      reason: "The publisher revoked this release. The previous plugin profile was restored automatically.",
    };
    render(<UpdaterDialog />);
    expect(screen.getByText("Plugin update rolled back")).toBeDefined();
    expect(screen.getByText(/restored automatically/)).toBeDefined();
  });
});
