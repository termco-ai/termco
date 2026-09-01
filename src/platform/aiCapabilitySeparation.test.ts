import type {
  AiSessionsCapability,
  AiSessionsHostControl,
} from "@termco/ai-sessions-base";
import type { AiToolRegistry } from "@termco/ai-tools-base";
import type { SessionHistoryCapability } from "@termco/session-base";
import type {
  UiWorkspaceComposerCapability,
  UiWorkspaceComposerHostControl,
} from "@termco/ui-workspace-base";
import { describe, expect, it } from "vitest";
import aiRegistry from "../../plugin-repository/plugins/ai-registry-native/src/plugin";
import aiSessionState from "../../plugin-repository/plugins/ai-session-state-native/src/plugin";
import type { ResolvedPluginTree } from "./contracts";
import { CapabilityRuntime, type PluginModule } from "./runtime";

const ids = [
  "session-history",
  "ai-registry-native",
  "ai-session-state-native",
  "tool-contributor",
  "chat-presentation",
] as const;

function tree(): ResolvedPluginTree {
  return {
    profileId: "ai-separation-test",
    activationOrder: [...ids],
    plugins: ids.map((id) => ({
      id,
      manifest: {
        schemaVersion: 3,
        id,
        name: id,
        description: id,
        category: "Test",
        version: "1.0.0",
        entrypoints: { renderer: "src/plugin.ts" },
        dependencies: {},
      },
      source: { type: "bundled", module: `bundled:${id}`, location: id },
    })),
  };
}

function sessionDelegate(): AiSessionsCapability {
  return {
    snapshot: () => ({
      revision: 1,
      panelOpen: true,
      miniOpen: false,
      selectedModelId: "model-a",
      activeSessionId: "session-a",
      agent: { status: "idle", step: null, error: null },
    }),
    subscribe: () => () => {},
    openPanel: () => {},
    closePanel: () => {},
    togglePanel: () => {},
    openMini: () => {},
    closeMini: () => {},
    focusInput: () => {},
    attachSelection: () => {},
    attachFile: () => {},
    attachImage: () => {},
    openSession: async () => {},
    rerunFrom: async () => ({ childSessionId: "child-session" as never }),
    sessionContext: () => ({ rigId: "default" }),
    sendMessage: async () => {},
    respondToApproval: () => {},
  };
}

describe("AI capability ownership separation", () => {
  it("keeps registries, tool contributions, session history identity, and composer facade after Chat leaves", async () => {
    const runtime = new CapabilityRuntime(tree());
    const sessionHistory: PluginModule = {
      activate(context) {
        context.provide(
          "session.history",
          {} as SessionHistoryCapability,
        );
      },
    };
    await runtime.activate("session-history", sessionHistory);
    await runtime.activate("ai-registry-native", aiRegistry);
    await runtime.activate("ai-session-state-native", aiSessionState);
    const contributor: PluginModule = {
      inject: ["ai.tools"],
      activate(context) {
        return context.get<AiToolRegistry>("ai.tools").register({
          id: "independent-tool",
          group: "test",
          build: () => ({}),
        });
      },
    };
    await runtime.activate("tool-contributor", contributor);
    const chat: PluginModule = {
      inject: ["ai.sessions", "ui.workspace-composer"],
      async activate(context) {
        await context.effect(() =>
          (
            context.get<AiSessionsCapability>("ai.sessions") as
              AiSessionsCapability & AiSessionsHostControl
          ).bind(sessionDelegate()),
        );
        await context.effect(() =>
          (
            context.get<UiWorkspaceComposerCapability>(
              "ui.workspace-composer",
            ) as UiWorkspaceComposerCapability & UiWorkspaceComposerHostControl
          ).bind({
            snapshot: () => ({
              revision: 1,
              available: true,
              hostedElsewhere: false,
            }),
            subscribe: () => () => {},
            focus: () => {},
            Region: () => null,
          }),
        );
      },
    };
    await runtime.activate("chat-presentation", chat);

    const tools = runtime.platformCapability<AiToolRegistry>("ai.tools");
    const sessions = runtime.platformCapability<AiSessionsCapability>(
      "ai.sessions",
    );
    const composer = runtime.platformCapability<UiWorkspaceComposerCapability>(
      "ui.workspace-composer",
    );
    expect(sessions.snapshot().activeSessionId).toBe("session-a");
    expect(composer.snapshot().available).toBe(true);

    await runtime.deactivate("chat-presentation");

    expect(runtime.platformCapability("ai.tools")).toBe(tools);
    expect(runtime.platformCapability("ai.sessions")).toBe(sessions);
    expect(runtime.platformCapability("ui.workspace-composer")).toBe(composer);
    expect(tools.snapshot().map((entry) => entry.id)).toEqual([
      "independent-tool",
    ]);
    expect(sessions.snapshot().activeSessionId).toBe("session-a");
    expect(composer.snapshot()).toMatchObject({
      available: false,
      hostedElsewhere: false,
    });
  });
});
