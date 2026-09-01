/**
 * Command registry + dispatch. Every backend command registers here
 * via `command(name, handler)`; the renderer reaches them through the preload
 * bridge (`termco:invoke` / `termco:invoke-raw`).
 */
import type { WebContents } from "electron";

/** A streaming channel marker as it arrives in a command payload. */
export interface ChannelMarker {
  __termcoChannel: number;
}

export type ChannelSender = (message: unknown) => void;

export interface CommandContext {
  sender: WebContents;
  /** Turn a `{ __termcoChannel }` marker (or raw id) into a message sender. */
  channel(marker: ChannelMarker | number | undefined): ChannelSender;
  /** Present only for the raw-bytes fast path (pty_write). */
  raw?: { bytes: Uint8Array; headers: Record<string, string> };
}

type Handler = (
  payload: Record<string, unknown>,
  ctx: CommandContext,
) => Promise<unknown> | unknown;

/**
 * Optional per-command metadata (typed-bus foundation): a payload validator
 * enforced at dispatch, plus machine-readable classification for tooling
 * (catalog commands, developer tooling, and consent surfaces).
 */
export type CommandMeta = {
  /** Structural validator (zod schema or anything with `parse`). Dispatch
   * runs it BEFORE the handler; a mismatch throws a teaching error instead
   * of the handler crashing on a hand-cast. */
  payload?: { parse: (value: unknown) => unknown };
  /** Mutates user-visible state. Callers that need this classification must
   * declare it explicitly; the open-service kernel does not infer it. */
  destructive?: boolean;
  /** Purely observational — safe to call speculatively. */
  readOnly?: boolean;
  description?: string;
};

const handlers = new Map<string, Handler>();
const metas = new Map<string, CommandMeta>();

/**
 * Register a command. Returns a disposer that removes exactly this
 * registration — main plugins wrap every `command()` in `ctx.effect()` so a
 * plugin's commands vanish atomically when it is disabled.
 */
export function command(
  name: string,
  handler: Handler,
  meta?: CommandMeta,
): () => void {
  if (handlers.has(name)) {
    throw new Error(`duplicate command registration: ${name}`);
  }
  handlers.set(name, handler);
  if (meta) metas.set(name, meta);
  return () => {
    if (handlers.get(name) === handler) {
      handlers.delete(name);
      metas.delete(name);
    }
  };
}

export function hasCommand(name: string): boolean {
  return handlers.has(name);
}

export function registeredCommands(): string[] {
  return [...handlers.keys()].sort();
}

export function commandMeta(name: string): CommandMeta | undefined {
  return metas.get(name);
}

export async function dispatch(
  name: string,
  payload: Record<string, unknown>,
  ctx: CommandContext,
): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(`unknown command: ${name}`);
  }
  const meta = metas.get(name);
  let checked = payload ?? {};
  if (meta?.payload) {
    try {
      checked = meta.payload.parse(checked) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `command "${name}": invalid payload — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return handler(checked, ctx);
}

/** Build the per-invocation context bound to the calling window's webContents. */
export function makeContext(
  sender: WebContents,
  raw?: CommandContext["raw"],
): CommandContext {
  return {
    sender,
    raw,
    channel(marker) {
      const id =
        typeof marker === "number" ? marker : marker?.__termcoChannel;
      return (message: unknown) => {
        if (id == null || sender.isDestroyed()) return;
        sender.send("termco:channel", id, message);
      };
    },
  };
}
