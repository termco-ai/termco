import { describe, expect, it, vi } from "vitest";
import {
  bindProcessTransport,
  createProcessServiceProxy,
} from "./remoteCapabilities";
import {
  deliverProcessChannelMessage,
  electronCapabilityTransport,
  subscribeElectronHostEvent,
} from "./electronTransport";

describe("Electron process channel transport", () => {
  it("preserves every callback argument without knowing its product shape", () => {
    const listener = vi.fn();

    deliverProcessChannelMessage(listener, {
      __termcoChannelArgs: ["event-name", { value: 3 }],
    });

    expect(listener).toHaveBeenCalledExactlyOnceWith("event-name", {
      value: 3,
    });
  });

  it("rejects messages outside the current channel envelope", () => {
    const listener = vi.fn();

    expect(() => deliverProcessChannelMessage(listener, "data")).toThrow(
      "invalid process channel message envelope",
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it("projects generic preload host events with synchronous cleanup", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const remove = vi.fn();
    const previous = (
      globalThis as typeof globalThis & { __termco?: unknown }
    ).__termco;
    (
      globalThis as typeof globalThis & { __termco?: unknown }
    ).__termco = {
      onWindowEvent(name: string, listener: (payload: unknown) => void) {
        listeners.set(name, listener);
        return remove;
      },
    };
    try {
      const listener = vi.fn();
      const dispose = subscribeElectronHostEvent("company.host-event", listener);

      expect(dispose).toBeTypeOf("function");
      listeners.get("company.host-event")?.({ value: 7 });
      expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 7 });
      dispose();
      expect(remove).toHaveBeenCalledOnce();
    } finally {
      (
        globalThis as typeof globalThis & { __termco?: unknown }
      ).__termco = previous;
    }
  });

  it("unwraps typed capability failures inside the renderer realm", async () => {
    const previous = (
      globalThis as typeof globalThis & { __termco?: unknown }
    ).__termco;
    (
      globalThis as typeof globalThis & { __termco?: unknown }
    ).__termco = {
      capabilityCall: vi.fn(),
      capabilityCallWire: vi.fn(async () => ({
        ok: false,
        error: {
          name: "SessionPersistenceError",
          message: "session missing-session does not exist",
          code: "SESSION_NOT_FOUND",
        },
      })),
    };
    try {
      const history = createProcessServiceProxy<{
        inspect(sessionId: string): Promise<unknown>;
      }>(
        "session.history",
        bindProcessTransport("ai-chat-native", electronCapabilityTransport),
      );

      await expect(history.inspect("missing-session")).rejects.toMatchObject({
        name: "SessionPersistenceError",
        message: "session missing-session does not exist",
        code: "SESSION_NOT_FOUND",
      });
    } finally {
      (
        globalThis as typeof globalThis & { __termco?: unknown }
      ).__termco = previous;
    }
  });
});
