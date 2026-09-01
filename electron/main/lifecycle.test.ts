import { describe, expect, it, vi } from "vitest";
import { registerMainLifecycle } from "./lifecycle";

describe("main-process lifecycle", () => {
  it("keeps termco:services:call registered until renderer windows are gone", () => {
    const listeners = new Map<string, () => void>();
    let capabilityHandlerRegistered = true;
    const app = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return app;
      }),
    };
    const dependencies = {
      setAppQuitting: vi.fn(),
      disposePluginRuntime: vi.fn(() => {
        capabilityHandlerRegistered = false;
      }),
    };
    registerMainLifecycle(app as never, dependencies);

    listeners.get("before-quit")?.();

    // BrowserWindow renderers can still run cleanup effects between these two
    // Electron lifecycle events. This is the exact window that previously
    // produced "No handler registered for 'termco:services:call'".
    expect(() => {
      if (!capabilityHandlerRegistered) {
        throw new Error("No handler registered for 'termco:services:call'");
      }
    }).not.toThrow();
    expect(dependencies.setAppQuitting).toHaveBeenCalledOnce();
    expect(dependencies.disposePluginRuntime).not.toHaveBeenCalled();

    listeners.get("will-quit")?.();
    listeners.get("will-quit")?.();

    expect(dependencies.disposePluginRuntime).toHaveBeenCalledOnce();
    expect(capabilityHandlerRegistered).toBe(false);
  });
});
