/**
 * Typed-bus contract: payload schemas are enforced AT DISPATCH (a handler
 * must never see an unvalidated payload once it declares one), and command
 * metadata is queryable for tooling/consent surfaces.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  command,
  commandMeta,
  dispatch,
  hasCommand,
  registeredCommands,
  type CommandContext,
} from "./ipc";

const ctx = {
  sender: null as unknown as CommandContext["sender"],
  channel: () => () => {},
} satisfies CommandContext;

describe("command registration", () => {
  it("registers, dispatches and disposes", async () => {
    const off = command("test_echo", (p) => p.value);
    expect(hasCommand("test_echo")).toBe(true);
    expect(registeredCommands()).toContain("test_echo");
    await expect(dispatch("test_echo", { value: 42 }, ctx)).resolves.toBe(42);
    off();
    expect(hasCommand("test_echo")).toBe(false);
    await expect(dispatch("test_echo", {}, ctx)).rejects.toThrow(
      /unknown command/,
    );
  });

  it("refuses duplicate registrations", () => {
    const off = command("test_dup", () => null);
    expect(() => command("test_dup", () => null)).toThrow(/duplicate command/);
    off();
  });
});

describe("payload validation", () => {
  it("passes a valid payload through (and hands the PARSED value on)", async () => {
    const handler = vi.fn((p: Record<string, unknown>) => p.id);
    const off = command("test_validated", handler, {
      payload: z.object({ id: z.string().min(1) }),
    });
    await expect(dispatch("test_validated", { id: "abc" }, ctx)).resolves.toBe(
      "abc",
    );
    off();
  });

  it("rejects an invalid payload BEFORE the handler runs", async () => {
    const handler = vi.fn(() => "should not run");
    const off = command("test_guarded", handler, {
      payload: z.object({ id: z.string() }),
    });
    await expect(dispatch("test_guarded", { id: 7 }, ctx)).rejects.toThrow(
      /invalid payload/,
    );
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("leaves unvalidated commands untouched (opt-in migration)", async () => {
    const off = command("test_loose", (p) => p.anything);
    await expect(dispatch("test_loose", { anything: "ok" }, ctx)).resolves.toBe(
      "ok",
    );
    off();
  });
});

describe("command metadata", () => {
  it("is queryable and disposed with the registration", () => {
    const off = command("test_meta", () => null, {
      readOnly: true,
      description: "does nothing",
    });
    expect(commandMeta("test_meta")).toMatchObject({
      readOnly: true,
      description: "does nothing",
    });
    off();
    expect(commandMeta("test_meta")).toBeUndefined();
  });
});
