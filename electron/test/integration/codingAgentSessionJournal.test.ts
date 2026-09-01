import { SessionId } from "@termco/session-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemorySessionHistory } from "../../../plugin-repository/plugins/session-native/src/index";
import {
  configureAgentSessionJournal,
  ensureAgentSession,
  recordAgentCheckpoint,
  recordAgentEvent,
  resetSessionJournal,
  sessionJournalSettled,
} from "../../../plugin-repository/plugins/coding-agent-native/src/sessionJournal";

describe("coding-agent canonical session journal", () => {
  const history = createInMemorySessionHistory();

  beforeEach(() => {
    resetSessionJournal();
    configureAgentSessionJournal(history);
  });

  afterEach(() => {
    configureAgentSessionJournal(null);
  });

  it("creates one adapter-fidelity session and lets the owner allocate every sequence", async () => {
    ensureAgentSession("agent-run-a", () => ({
      backend: "codex",
      model: "gpt-5.6-sol",
      rigId: "default",
      startedAt: 100,
      title: "Fix the app",
    }));
    recordAgentEvent("agent-run-a", "user-prompt", { text: "Fix the app" });
    recordAgentEvent("agent-run-a", "agent-session", { sessionId: "backend-session-a" });
    recordAgentCheckpoint("agent-run-a", {
      checkpointId: "agent-run-a:0",
      backend: "git",
      reference: { turnIndex: 0 },
    });
    await sessionJournalSettled("agent-run-a");

    const window = await history.readWindow(SessionId("agent-run-a"), { kind: "head", limit: 20 });
    expect(window.header).toMatchObject({
      id: "agent-run-a",
      backend: "codex",
      fidelity: "adapter",
      rigId: "default",
    });
    expect(window.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(window.events.map((event) => event.type)).toEqual([
      "session/title",
      "adapter/event",
      "adapter/event",
      "adapter/event",
      "workspace/checkpoint",
    ]);
  });

  it("reuses an existing session when a backend run resumes", async () => {
    ensureAgentSession("agent-run-b", () => ({ backend: "claude", startedAt: 100, title: "First" }));
    recordAgentEvent("agent-run-b", "status", { status: "idle" });
    await sessionJournalSettled("agent-run-b");
    ensureAgentSession("agent-run-b", () => ({ backend: "claude", startedAt: 200, title: "Duplicate" }));
    recordAgentEvent("agent-run-b", "user-prompt", { text: "Continue" });
    await sessionJournalSettled("agent-run-b");

    const window = await history.readWindow(SessionId("agent-run-b"), { kind: "head", limit: 20 });
    expect(window.events.filter((event) => event.type === "session/title")).toHaveLength(1);
    expect(window.events.map((event) => event.seq)).toEqual([0, 1, 2, 3]);
  });
});
