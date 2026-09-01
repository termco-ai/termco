import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  stopDevProcesses,
  stopDevStack,
} from "../../scripts/dev-process-lifecycle.mjs";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  });
}

describe("dev process shutdown", () => {
  it("waits for every child to exit after an intentional SIGTERM", async () => {
    const renderer = new FakeChild();
    const electron = new FakeChild();

    await stopDevProcesses([renderer, electron]);

    expect(renderer.kill).toHaveBeenCalledWith("SIGTERM");
    expect(electron.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("lets Electron release native resources before stopping Vite", async () => {
    const order: string[] = [];
    const electron = new FakeChild();
    const vite = new FakeChild();
    electron.kill.mockImplementation((signal: NodeJS.Signals) => {
      order.push(`electron:${signal}`);
      electron.signalCode = signal;
      queueMicrotask(() => electron.emit("exit", null, signal));
      return true;
    });
    vite.kill.mockImplementation((signal: NodeJS.Signals) => {
      order.push(`vite:${signal}`);
      vite.signalCode = signal;
      queueMicrotask(() => vite.emit("exit", null, signal));
      return true;
    });

    await stopDevStack(electron, [vite]);

    expect(order).toEqual(["electron:SIGTERM", "vite:SIGTERM"]);
  });
});
