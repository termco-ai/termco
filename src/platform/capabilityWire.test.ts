import { describe, expect, it } from "vitest";
import {
  captureCapabilityResult,
  unwrapCapabilityResult,
} from "./capabilityWire";

describe("capability IPC wire result", () => {
  it("returns provider failures as data and rejects only after renderer unwrap", async () => {
    const wire = await captureCapabilityResult(() => {
      const error = new Error("ssh network is unreachable") as Error & {
        code?: string;
      };
      error.code = "SSH_UNREACHABLE";
      throw error;
    });

    expect(wire).toEqual({
      ok: false,
      error: {
        name: "Error",
        message: "ssh network is unreachable",
        code: "SSH_UNREACHABLE",
      },
    });
    expect(() => unwrapCapabilityResult(wire)).toThrow(
      "ssh network is unreachable",
    );
  });

  it("round-trips successful values", async () => {
    const wire = await captureCapabilityResult(() => ({ entries: 3 }));
    expect(unwrapCapabilityResult(wire)).toEqual({ entries: 3 });
  });

  it("preserves typed provider errors from a different JavaScript realm", async () => {
    const providerError = Object.assign(Object.create(null) as object, {
      name: "SessionPersistenceError",
      message: "session missing-session does not exist",
      code: "SESSION_NOT_FOUND",
    });

    const wire = await captureCapabilityResult(() => {
      throw providerError;
    });

    expect(wire).toEqual({
      ok: false,
      error: {
        name: "SessionPersistenceError",
        message: "session missing-session does not exist",
        code: "SESSION_NOT_FOUND",
      },
    });
    expect(() => unwrapCapabilityResult(wire)).toThrow(
      expect.objectContaining({
        name: "SessionPersistenceError",
        message: "session missing-session does not exist",
        code: "SESSION_NOT_FOUND",
      }),
    );
  });
});
