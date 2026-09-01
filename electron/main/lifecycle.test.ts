import { describe, expect, it, vi } from "vitest";
import { registerMainLifecycle } from "./lifecycle";

describe("main-process lifecycle", () => {
  it("keeps IPC alive until windows close, then waits for runtime disposal before exiting", async () => {
    const listeners = new Map<
      string,
      (event?: { preventDefault: () => void }) => void
    >();
    let capabilityHandlerRegistered = true;
    let finishDisposal: (() => void) | undefined;
    const app = {
      on: vi.fn((
        event: string,
        listener: (event?: { preventDefault: () => void }) => void,
      ) => {
        listeners.set(event, listener);
        return app;
      }),
      exit: vi.fn(),
    };
    const dependencies = {
      setAppQuitting: vi.fn(),
      disposePluginRuntime: vi.fn(() => new Promise<void>((resolve) => {
        finishDisposal = () => {
          capabilityHandlerRegistered = false;
          resolve();
        };
      })),
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

    const willQuitEvent = { preventDefault: vi.fn() };
    listeners.get("will-quit")?.(willQuitEvent);
    listeners.get("will-quit")?.(willQuitEvent);

    expect(dependencies.disposePluginRuntime).toHaveBeenCalledOnce();
    expect(willQuitEvent.preventDefault).toHaveBeenCalledTimes(2);
    expect(app.exit).not.toHaveBeenCalled();
    finishDisposal?.();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(capabilityHandlerRegistered).toBe(false);
  });
});
