import { describe, expect, it, vi } from "vitest";
import {
  ELECTRON_EXECUTABLE,
  spawnElectronProcess,
} from "../../scripts/dev-electron-process.mjs";

describe("dev Electron process", () => {
  it("spawns the real application executable so restarts cannot orphan it", () => {
    expect(ELECTRON_EXECUTABLE).toMatch(
      process.platform === "darwin"
        ? /Electron\.app\/Contents\/MacOS\/Electron$/
        : process.platform === "win32"
          ? /electron\.exe$/i
          : /electron$/,
    );
    expect(ELECTRON_EXECUTABLE).not.toMatch(/(?:cli\.js|node_modules\/\.bin)/);

    const child = { on: vi.fn() };
    const spawn = vi.fn(() => child);
    expect(
      spawnElectronProcess(spawn, { TERMCO_MCP_PORT: "0" }, "http://localhost:1420"),
    ).toBe(child);
    expect(spawn).toHaveBeenCalledWith(
      ELECTRON_EXECUTABLE,
      ["."],
      expect.objectContaining({
        env: expect.objectContaining({
          TERMCO_MCP_PORT: "0",
          VITE_DEV_SERVER_URL: "http://localhost:1420",
        }),
      }),
    );
  });
});
