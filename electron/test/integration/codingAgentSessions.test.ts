import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createTranscript,
} from "../../../plugin-repository/plugins/coding-agent-native/ui/lib/transcript";
import {
  slugFromCwd,
  transcriptToEvents,
} from "../../../plugin-repository/plugins/coding-agent-native/src/sessions";

describe("slugFromCwd", () => {
  it("encodes an absolute cwd as a project directory slug", () => {
    expect(slugFromCwd("/Users/developer/Projects/example-app")).toBe(
      "-Users-developer-Projects-example-app",
    );
  });
});

// Real transcript shapes: each line has a
// `type`, a `message.{role,content}`, and a `sessionId`.
const L = (o: unknown) => JSON.stringify(o);
const SID = "sess-1";
const TRANSCRIPT = [
  L({ type: "user", sessionId: SID, isMeta: true, message: { role: "user", content: "<system-reminder>internal</system-reminder>" } }),
  L({ type: "user", sessionId: SID, message: { role: "user", content: "Fix the failing test" } }),
  L({
    type: "assistant",
    sessionId: SID,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me look", signature: "x" },
        { type: "text", text: "Reading the test file." },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.test.ts" } },
      ],
    },
  }),
  L({
    type: "user",
    sessionId: SID,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "expect(x).toBe(1)" }] },
  }),
  L({ type: "assistant", sessionId: SID, message: { role: "assistant", content: [{ type: "text", text: "Fixed it." }] } }),
  // A line from a different session must be ignored.
  L({ type: "assistant", sessionId: "other", message: { role: "assistant", content: [{ type: "text", text: "leak" }] } }),
];

describe("transcriptToEvents", () => {
  it("maps a real transcript into normalized events (no doubling, filters noise)", () => {
    const evs = transcriptToEvents(TRANSCRIPT, SID);
    const types = evs.map((e) => e.type);
    expect(types).toEqual([
      "user-message", // the human prompt (the meta system-reminder was dropped)
      "message-start",
      "reasoning",
      "text",
      "tool-start",
      "message-end",
      "tool-end",
      "message-start",
      "text",
      "message-end",
    ]);
    // The "other" session's leak text never appears.
    expect(evs).not.toContainEqual({ type: "text", text: "leak" });
  });

  it("folds into a clean transcript: 1 user + 2 assistant messages, no dupes", () => {
    const state = transcriptToEvents(TRANSCRIPT, SID).reduce(applyEvent, createTranscript(SID));
    const roles = state.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "assistant"]);
    const firstAssistant = state.messages[1].parts as Array<Record<string, unknown>>;
    expect(firstAssistant.map((p) => p.type)).toEqual(["reasoning", "text", "tool-Read"]);
    expect(firstAssistant[2]).toMatchObject({ state: "output-available", output: "expect(x).toBe(1)" });
  });
});
// Owned by the coding-agent-native provider plugin.
