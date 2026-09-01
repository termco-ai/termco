/**
 * End-to-end parse pipeline test: raw CLI NDJSON, chunked arbitrarily (as a real
 * pipe delivers it), through the line splitter + adapter + transcript reducer,
 * and assert the final rendered transcript. This exercises the whole main-side
 * data path without spawning a process.
 */
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from "../../../plugin-repository/plugins/coding-agent-native/ui/lib/transcript";
import { createClaudeAdapter } from "../../../plugin-repository/plugins/coding-agent-native/src/claudeAdapter";
import { createLineSplitter } from "../../../plugin-repository/plugins/coding-agent-native/src/lineSplitter";

/** Feed raw bytes (split at arbitrary offsets) through the full pipeline. */
function drive(raw: string, chunkSize: number): TranscriptState {
  const adapter = createClaudeAdapter();
  const splitter = createLineSplitter();
  let state = createTranscript("r1");
  const consume = (lines: string[]) => {
    for (const line of lines) {
      for (const ev of adapter.parseLine(line)) state = applyEvent(state, ev);
    }
  };
  for (let i = 0; i < raw.length; i += chunkSize) {
    consume(splitter.push(raw.slice(i, i + chunkSize)));
  }
  consume(splitter.flush());
  return state;
}

// Real stream-json shape (complete messages only; the interleaved
// `stream_event` partials that caused doubling are NOT requested/handled).
const NDJSON = [
  { type: "system", subtype: "init", session_id: "s1", model: "opus", cwd: "/repo" },
  // First assistant message: text + a tool call.
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Reading the file." },
        { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
      ],
    },
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "export const x = 1" }] },
  },
  // Second assistant message.
  { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } },
  { type: "result", subtype: "success", total_cost_usd: 0.001, usage: { input_tokens: 5 } },
]
  .map((o) => JSON.stringify(o))
  .join("\n");

describe("line splitter", () => {
  it("reassembles lines split across chunk boundaries", () => {
    const s = createLineSplitter();
    expect(s.push("hel")).toEqual([]);
    expect(s.push("lo\nwor")).toEqual(["hello"]);
    expect(s.push("ld\n")).toEqual(["world"]);
    expect(s.flush()).toEqual([]);
  });

  it("flush returns a trailing unterminated line", () => {
    const s = createLineSplitter();
    expect(s.push("a\nb")).toEqual(["a"]);
    expect(s.flush()).toEqual(["b"]);
  });
});

describe("parse pipeline (claude)", () => {
  for (const chunk of [1, 7, 64, 100000]) {
    it(`produces the same transcript regardless of chunk size (${chunk})`, () => {
      const s = drive(NDJSON, chunk);
      expect(s.status).toBe("idle");
      expect(s.sessionId).toBe("s1");
      expect(s.costUsd).toBe(0.001);
      // Two assistant messages: [text+tool] then [Done.].
      expect(s.messages.map((m) => m.role)).toEqual(["assistant", "assistant"]);
      const first = s.messages[0].parts as Array<Record<string, unknown>>;
      expect(first[0]).toMatchObject({ type: "text", text: "Reading the file." });
      expect(first[1]).toMatchObject({
        type: "tool-read_file",
        toolCallId: "t1",
        state: "output-available",
        output: "export const x = 1",
      });
      const second = s.messages[1].parts as Array<Record<string, unknown>>;
      expect(second[0]).toMatchObject({ type: "text", text: "Done." });
    });
  }
});
// Owned by the coding-agent-native provider plugin.
