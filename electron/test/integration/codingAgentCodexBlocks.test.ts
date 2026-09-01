import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createTranscript,
} from "../../../plugin-repository/plugins/coding-agent-native/ui/lib/transcript";
import { codexRolloutToEvents } from "../../../plugin-repository/plugins/coding-agent-native/src/codexBlocks";

const L = (o: unknown) => JSON.stringify(o);

describe("codexRolloutToEvents", () => {
  it("translates real rollout shapes (message/reasoning/exec/apply_patch)", () => {
    // Shapes taken verbatim from a real backend rollout.
    const lines = [
      L({ type: "session_meta", payload: { id: "s1", session_id: "s1", cwd: "/repo" } }),
      L({ type: "event_msg", payload: { type: "task_started" } }),
      // A `developer` role message (permissions wall) MUST be dropped.
      L({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions instructions> ..." }] } }),
      L({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the bug" }] } }),
      L({ type: "response_item", payload: { type: "reasoning", summary: [], encrypted_content: "…" } }),
      L({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "On it." }] } }),
      // Command items use `exec_command` with arguments keyed by `cmd`.
      L({ type: "response_item", payload: { type: "function_call", call_id: "c1", name: "exec_command", arguments: '{"cmd":"ls -la","workdir":"/repo"}' } }),
      L({ type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "a.ts\nb.ts" } }),
      L({ type: "response_item", payload: { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** patch ***" } }),
      L({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c2", output: "Success." } }),
      "not json",
    ];
    const events = codexRolloutToEvents(lines);
    expect(events).toEqual([
      { type: "user-message", text: "fix the bug" }, // developer message dropped, encrypted reasoning dropped
      { type: "text", text: "On it." },
      { type: "tool-start", toolCallId: "c1", name: "shell", input: { command: "ls -la" } },
      { type: "tool-end", toolCallId: "c1", output: "a.ts\nb.ts" },
      { type: "tool-start", toolCallId: "c2", name: "apply_patch", input: { patch: "*** patch ***" } },
      { type: "tool-end", toolCallId: "c2", output: "Success." },
    ]);
  });

  it("folds into a coherent read-only transcript via the reducer", () => {
    const events = codexRolloutToEvents([
      L({ type: "response_item", payload: { type: "message", role: "user", content: "hi" } }),
      L({ type: "response_item", payload: { type: "message", role: "assistant", content: "hello" } }),
    ]);
    let s = createTranscript("hist:codex:s1");
    for (const e of events) s = applyEvent(s, e);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((s.messages[1].parts[0] as { text: string }).text).toBe("hello");
  });

  it("ignores internal system-reminder text and empty content", () => {
    const events = codexRolloutToEvents([
      L({ type: "response_item", payload: { type: "message", role: "user", content: "<system-reminder>x</system-reminder>" } }),
      L({ type: "response_item", payload: { type: "message", role: "assistant", content: "" } }),
    ]);
    expect(events).toEqual([]);
  });

  it("is tolerant of unknown/garbage lines", () => {
    expect(codexRolloutToEvents(["", "{bad", L({ nope: 1 })])).toEqual([]);
  });
});
// Owned by the coding-agent-native provider plugin.
