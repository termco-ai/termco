import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

async function replaceSource(input: {
  page: Page;
  userData: string;
  originalPluginId: string;
  replacementId: string;
  relativePath: string;
  edit(source: string): string;
}): Promise<void> {
  const copied = await input.page.evaluate(
    ({ pluginId, replacementId }) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan({ pluginId, replacementId }),
    { pluginId: input.originalPluginId, replacementId: input.replacementId },
  );
  expect(copied.status).toBe("replaced");
  const file = join(
    input.userData,
    "plugin-platform",
    "plugins",
    input.replacementId,
    input.relativePath,
  );
  expect(existsSync(file)).toBe(true);
  const source = readFileSync(file, "utf8");
  const edited = input.edit(source);
  expect(edited).not.toBe(source);
  writeFileSync(file, edited);
  const reloaded = await input.page.evaluate(
    (pluginId) => window.__termco.applyPlugin(pluginId),
    input.replacementId,
  );
  expect(reloaded.status).toBe("replaced");
}

async function capability(
  page: Page,
  consumerPluginId: string,
  capabilityId: string,
  method: string,
  args: unknown[],
) {
  return page.evaluate(
    ({ consumerPluginId, capabilityId, method, args }) =>
      window.__termco.capabilityCall({
        consumerPluginId,
        capability: capabilityId,
        method,
        args,
      }),
    { consumerPluginId, capabilityId, method, args },
  );
}

async function seam(page: Page, name: string): Promise<unknown> {
  return page.evaluate((key) => {
    const value = (window as unknown as {
      __termcoE2E?: Record<string, unknown>;
    }).__termcoE2E?.[key];
    return typeof value === "function" ? value() : value;
  }, name);
}

async function certify(input: {
  page: Page;
  originalPluginId: string;
  replacementId: string;
  assertReplacement(): Promise<void>;
  assertRestored?(): Promise<void>;
}) {
  await input.assertReplacement();
  await expectWholeFolderReplacementSelected(
    input.page,
    input.originalPluginId,
    input.replacementId,
  );
  await revertWholeFolderReplacement(
    input.page,
    input.originalPluginId,
    input.replacementId,
  );
  await input.assertRestored?.();
}

// @termco-certifies copy-replace agent-hooks-native source=src/main.ts runtime=e2e_hook_status
test("agent hooks replacement reaches the unchanged managed-agent consumer", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "agent-hooks-native",
    replacementId: "e2e.agent-hooks",
    relativePath: "src/main.ts",
    edit: (source) => source.replace("status(agent) {", 'status(agent) {\n        if (agent === "e2e-agent") return true;'),
  });
  await certify({
    page,
    originalPluginId: "agent-hooks-native",
    replacementId: "e2e.agent-hooks",
    assertReplacement: async () => expect(await capability(page, "managed-agent-runtime-native", "agents.terminal-hooks", "status", ["e2e-agent"])).toBe(true),
    assertRestored: async () => expect(await capability(page, "managed-agent-runtime-native", "agents.terminal-hooks", "status", ["e2e-agent"])).toBe(false),
  });
});

// @termco-certifies copy-replace ai-diff-surface source=src/renderer.tsx runtime=E2E_AI_Diff_label
test("AI diff replacement changes the selected tab-surface contribution", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-diff-surface",
    replacementId: "e2e.ai-diff-runtime",
    relativePath: "src/renderer.tsx",
    edit: (source) => source.replace('label: "AI Diff Review"', 'label: "E2E AI Diff Review"'),
  });
  await certify({
    page,
    originalPluginId: "ai-diff-surface",
    replacementId: "e2e.ai-diff-runtime",
    assertReplacement: async () => expect(await seam(page, "aiDiffSurfaceLabel")).toBe("E2E AI Diff Review"),
    assertRestored: async () => expect(await seam(page, "aiDiffSurfaceLabel")).toBe("AI Diff Review"),
  });
});

// @termco-certifies copy-replace ai-inference-native source=src/inference.ts runtime=e2e_inference_configuration
test("AI inference replacement reaches the unchanged chat consumer", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-inference-native",
    replacementId: "e2e.ai-inference",
    relativePath: "src/inference.ts",
    edit: (source) => source.replace(
      "configuration: () => resolveInferenceConfiguration(dependencies),",
      'configuration: () => ({ configuredProviderIds: ["e2e-inference"], configuredCustomEndpointIds: [] }),',
    ),
  });
  await certify({
    page,
    originalPluginId: "ai-inference-native",
    replacementId: "e2e.ai-inference",
    assertReplacement: async () => expect(await seam(page, "aiInferenceConfiguration")).toEqual({ configuredProviderIds: ["e2e-inference"], configuredCustomEndpointIds: [] }),
    assertRestored: async () => expect(await seam(page, "aiInferenceConfiguration")).not.toEqual(expect.objectContaining({ configuredProviderIds: ["e2e-inference"] })),
  });
});

// @termco-certifies copy-replace events-native source=src/main.ts runtime=313_listener_count
test("event bridge replacement changes its projection without replacing kernel event state", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "events-native",
    replacementId: "e2e.events-native",
    relativePath: "src/main.ts",
    edit: (source) => source.replace(
      "context.get<KernelEventsCapability>(EVENTS_APPLICATION_SERVICE),",
      `{\n        ...context.get<KernelEventsCapability>(EVENTS_APPLICATION_SERVICE),\n        listenerCount: (event: string) =>\n          event === "e2e-event"\n            ? 313\n            : context\n                .get<KernelEventsCapability>(EVENTS_APPLICATION_SERVICE)\n                .listenerCount(event),\n      },`,
    ),
  });
  await certify({
    page,
    originalPluginId: "events-native",
    replacementId: "e2e.events-native",
    assertReplacement: async () => {
      expect(
        await capability(
          page,
          "e2e.events-native",
          "events.application",
          "listenerCount",
          ["e2e-event"],
        ),
      ).toBe(313);
      expect(
        await capability(
          page,
          "ai-library-native",
          "kernel.events",
          "listenerCount",
          ["e2e-event"],
        ),
      ).toBe(0);
    },
    assertRestored: async () =>
      expect(
        await capability(
          page,
          "events-native",
          "events.application",
          "listenerCount",
          ["e2e-event"],
        ),
      ).toBe(0),
  });
});

// @termco-certifies copy-replace mcp-native source=src/main.ts runtime=E2E_MCP_client_call
test("MCP client replacement reaches library discovery and the unchanged chat tool", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "mcp-native",
    replacementId: "e2e.mcp-native",
    relativePath: "src/main.ts",
    edit: (source) => source
      .replace(
        "      connect,",
        '      connect: async (options) => options.name === "e2e-provider" ? { ok: true, tools: [{ name: "ping", description: "E2E MCP client tool", inputSchema: { type: "object" } }] } : connect(options),',
      )
      .replace(
        "async call(name, tool, argumentsValue) {",
        'async call(name, tool, argumentsValue) {\n        if (name === "e2e-provider" && tool === "ping") return { content: [{ type: "text", text: "E2E MCP client pong" }] };',
      ),
  });
  await capability(page, "ai-chat-native", "ai.library", "addMcpServers", [[{
    name: "e2e-provider",
    command: "not-used-by-replacement",
  }]]);
  await expect.poll(() => page.evaluate(() => {
    const definitions = (window as unknown as { __termcoE2E?: { aiToolDefinitions?: () => Record<string, { description: string }> } }).__termcoE2E?.aiToolDefinitions?.();
    return definitions?.["mcp__e2e-provider__ping"]?.description ?? "";
  })).toBe("E2E MCP client tool");
  const invoked = await page.evaluate(() =>
    (window as unknown as { __termcoE2E?: { aiInvokeTool?: (name: string, input: unknown) => Promise<unknown> } }).__termcoE2E?.aiInvokeTool?.("mcp__e2e-provider__ping", {}),
  );
  expect(invoked).toEqual({ content: "E2E MCP client pong" });
  await capability(page, "ai-chat-native", "ai.library", "removeMcpServer", ["e2e-provider"]);
  await certify({
    page,
    originalPluginId: "mcp-native",
    replacementId: "e2e.mcp-native",
    assertReplacement: async () => {},
  });
});

// @termco-certifies copy-replace mcp-server-native source=src/main.ts runtime=e2e_mcp_server_command
test("MCP server replacement reaches the unchanged chat control consumer", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "mcp-server-native",
    replacementId: "e2e.mcp-server-native",
    relativePath: "src/main.ts",
    edit: (source) => source.replace("commands: () => COMMANDS,", 'commands: () => [...COMMANDS, "e2e_mcp_server_command"],'),
  });
  await certify({
    page,
    originalPluginId: "mcp-server-native",
    replacementId: "e2e.mcp-server-native",
    assertReplacement: async () => expect(await capability(page, "ai-chat-native", "mcp.server", "commands", [])).toContain("e2e_mcp_server_command"),
    assertRestored: async () => expect(await capability(page, "ai-chat-native", "mcp.server", "commands", [])).not.toContain("e2e_mcp_server_command"),
  });
});

// @termco-certifies copy-replace ssh-auto-connect source=src/renderer.tsx runtime=E2E_SSH_auto_connect_description
test("SSH startup replacement changes the selected background contribution", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "ssh-auto-connect",
    replacementId: "e2e.ssh-auto-connect",
    relativePath: "src/renderer.tsx",
    edit: (source) => source.replace("Reconnects restored SSH rigs", "E2E reconnects restored SSH rigs"),
  });
  await certify({
    page,
    originalPluginId: "ssh-auto-connect",
    replacementId: "e2e.ssh-auto-connect",
    assertReplacement: async () => expect(await seam(page, "sshAutoConnectDescription")).toContain("E2E reconnects"),
    assertRestored: async () => expect(await seam(page, "sshAutoConnectDescription")).not.toContain("E2E reconnects"),
  });
});

// @termco-certifies copy-replace ssh-native source=src/main.ts runtime=e2e_ssh_destination
test("SSH provider replacement reaches the unchanged startup consumer", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "ssh-native",
    replacementId: "e2e.ssh-native",
    relativePath: "src/main.ts",
    edit: (source) => source.replace("      destination,", '      destination: (target) => target.connectionId === "e2e-ssh" ? "e2e-ssh-destination" : destination(target),'),
  });
  const target = { connectionId: "e2e-ssh", host: "example.invalid", user: "tester" };
  await certify({
    page,
    originalPluginId: "ssh-native",
    replacementId: "e2e.ssh-native",
    assertReplacement: async () => expect(await capability(page, "ssh-auto-connect", "ssh.client", "destination", [target])).toBe("e2e-ssh-destination"),
    assertRestored: async () => expect(await capability(page, "ssh-auto-connect", "ssh.client", "destination", [target])).toBe("tester@example.invalid"),
  });
});

// @termco-certifies copy-replace theme-file-editing source=src/renderer.tsx runtime=E2E_theme_editing_description
test("theme-file editing replacement changes the selected background workflow", async ({ page, workspace }) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "theme-file-editing",
    replacementId: "e2e.theme-file-editing",
    relativePath: "src/renderer.tsx",
    edit: (source) => source.replace("Reapplies edited theme files", "E2E reapplies edited theme files"),
  });
  await certify({
    page,
    originalPluginId: "theme-file-editing",
    replacementId: "e2e.theme-file-editing",
    assertReplacement: async () => expect(await seam(page, "themeFileEditingDescription")).toContain("E2E reapplies"),
    assertRestored: async () => expect(await seam(page, "themeFileEditingDescription")).not.toContain("E2E reapplies"),
  });
});
