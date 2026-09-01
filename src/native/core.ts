/**
 * Renderer-side `invoke`, `Channel`, and `convertFileSrc` primitives, backed by
 * the Electron preload bridge. The two hot paths depend on
 * this file verbatim: `terminal/lib/pty-bridge.ts` (Channel<ArrayBuffer> + raw
 * pty_write) and capability transport streams (Channel<AiStreamEvent>).
 */
import { bridge } from "./bridge";

/** Streaming channel: set `onmessage`, receive messages pushed from main. */
export class Channel<T = unknown> {
  readonly id: number;
  #onmessage: (message: T) => void = () => {};

  constructor() {
    this.id = bridge().registerChannel((msg) => this.#onmessage(msg as T));
  }

  set onmessage(handler: (message: T) => void) {
    this.#onmessage = handler;
  }

  get onmessage(): (message: T) => void {
    return this.#onmessage;
  }

  /** Release the underlying preload handler. Call once the stream is finished
   * so long-lived streams (e.g. an agent run) don't leak a handler per run. */
  dispose(): void {
    bridge().releaseChannel(this.id);
  }
}

export interface InvokeOptions {
  headers?: Record<string, string> | Headers;
}

/** Channels are always top-level fields in command args (onData/onEvent/…). */
function replaceChannels(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in args) {
    const value = args[key];
    out[key] = value instanceof Channel ? { __termcoChannel: value.id } : value;
  }
  return out;
}

function headersToRecord(
  headers?: Record<string, string> | Headers,
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  return headers;
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: unknown,
  options?: InvokeOptions,
): Promise<T> {
  // Raw-bytes fast path: `invoke("pty_write", Uint8Array, { headers })`.
  if (args instanceof Uint8Array || args instanceof ArrayBuffer) {
    const bytes = args instanceof ArrayBuffer ? new Uint8Array(args) : args;
    return bridge().invokeRaw(
      cmd,
      bytes,
      headersToRecord(options?.headers),
    ) as Promise<T>;
  }
  const payload =
    args && typeof args === "object"
      ? replaceChannels(args as Record<string, unknown>)
      : (args ?? {});
  return bridge().invoke(cmd, payload) as Promise<T>;
}

/**
 * Turn a local file path into a URL the renderer can load. Backed by the
 * custom `termco-asset://` scheme registered in main.
 */
export function convertFileSrc(filePath: string, protocol = "asset"): string {
  const encoded = encodeURIComponent(filePath).replace(/%2F/g, "/");
  return `termco-asset://localhost/${encoded}?protocol=${protocol}`;
}
