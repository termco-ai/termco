import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// Rebinding selected tools reactivates the shared chat consumer. Its sessions
// are disposable here; production keeps the destructive-resource warning.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

type AiE2E = {
  aiToolDefinitions(): Record<string, { description: string }>;
  aiInvokeTool(name: string, input: unknown): Promise<unknown>;
  aiSpeechConfiguration(): Promise<{ configuredProviders: string[] }>;
  aiLiveKind(): string | null;
  aiRegistryProviderMarker(): string;
  aiSessionStateProviderMarker(): string;
};

function copiedSource(
  userData: string,
  replacementId: string,
  relativePath: string,
): string {
  return join(userData, "plugin-platform", "plugins", replacementId, relativePath);
}

async function replaceSource(
  page: Page,
  userData: string,
  originalPluginId: string,
  replacementId: string,
  relativePath: string,
  edit: (source: string) => string,
): Promise<void> {
  const copied = await page.evaluate(
    ({ pluginId, replacementPluginId }) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan({
        pluginId,
        replacementId: replacementPluginId,
      }),
    { pluginId: originalPluginId, replacementPluginId: replacementId },
  );
  expect(copied.status).toBe("replaced");
  const path = copiedSource(userData, replacementId, relativePath);
  expect(existsSync(path)).toBe(true);
  const original = readFileSync(path, "utf8");
  const edited = edit(original);
  expect(edited).not.toBe(original);
  writeFileSync(path, edited);
  const reloaded = await page.evaluate(
    (pluginId) => window.__termco.applyPlugin(pluginId),
    replacementId,
  );
  expect(reloaded.status).toBe("replaced");
}

function liveKind(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
    if (!seam) throw new Error("AI E2E seam is not active");
    return seam.aiLiveKind();
  });
}

function speechConfiguration(
  page: Page,
): Promise<{ configuredProviders: string[] }> {
  return page.evaluate(() => {
    const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
    if (!seam) throw new Error("AI E2E seam is not active");
    return seam.aiSpeechConfiguration();
  });
}

async function toolDescription(page: Page, name: string): Promise<string> {
  return page.evaluate((toolName) => {
    const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
    if (!seam) throw new Error("AI E2E seam is not active");
    return seam.aiToolDefinitions()[toolName]?.description ?? "";
  }, name);
}

async function invokeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(
    ({ toolName, toolInput }) => {
      const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
      if (!seam) throw new Error("AI E2E seam is not active");
      return seam.aiInvokeTool(toolName, toolInput);
    },
    { toolName: name, toolInput: input },
  );
}

function providerMarker(
  page: Page,
  key: "aiRegistryProviderMarker" | "aiSessionStateProviderMarker",
): Promise<string> {
  return page.evaluate((markerKey) => {
    const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
    if (!seam) throw new Error("AI E2E seam is not active");
    return seam[markerKey]();
  }, key);
}

// @termco-certifies copy-replace ai-registry-native source=src/plugin.ts runtime=ai-registry-e2e
test("AI registry provider replacement reaches its stable runtime seam", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "ai-registry-native",
    "e2e.ai-registry",
    "src/plugin.ts",
    (source) => source.replace("ai-registry-v1", "ai-registry-e2e"),
  );
  await expect
    .poll(() => providerMarker(page, "aiRegistryProviderMarker"))
    .toBe("ai-registry-e2e");
  await expectWholeFolderReplacementSelected(
    page,
    "ai-registry-native",
    "e2e.ai-registry",
  );
  await revertWholeFolderReplacement(
    page,
    "ai-registry-native",
    "e2e.ai-registry",
  );
  await expect
    .poll(() => providerMarker(page, "aiRegistryProviderMarker"))
    .toBe("ai-registry-v1");
});

// @termco-certifies copy-replace ai-session-state-native source=src/plugin.ts runtime=ai-session-state-e2e
test("AI session-state provider replacement preserves the unchanged Chat host", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "ai-session-state-native",
    "e2e.ai-session-state",
    "src/plugin.ts",
    (source) => source.replace("ai-session-state-v1", "ai-session-state-e2e"),
  );
  await expect
    .poll(() => providerMarker(page, "aiSessionStateProviderMarker"))
    .toBe("ai-session-state-e2e");
  await expectWholeFolderReplacementSelected(
    page,
    "ai-session-state-native",
    "e2e.ai-session-state",
  );
  await revertWholeFolderReplacement(
    page,
    "ai-session-state-native",
    "e2e.ai-session-state",
  );
  await expect
    .poll(() => providerMarker(page, "aiSessionStateProviderMarker"))
    .toBe("ai-session-state-v1");
});

async function certifyToolDescription(input: {
  page: Page;
  userData: string;
  originalPluginId: string;
  replacementId: string;
  relativePath: string;
  toolName: string;
  originalText: string;
  replacementText: string;
}): Promise<void> {
  await replaceSource(
    input.page,
    input.userData,
    input.originalPluginId,
    input.replacementId,
    input.relativePath,
    (source) => source.replace(input.originalText, input.replacementText),
  );
  await expect
    .poll(() => toolDescription(input.page, input.toolName))
    .toContain(input.replacementText);
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
  await expect
    .poll(() => toolDescription(input.page, input.toolName))
    .toContain(input.originalText);
  expect(await toolDescription(input.page, input.toolName)).not.toContain(
    input.replacementText,
  );
}

// @termco-certifies copy-replace ai-context-artifacts-native source=src/artifacts.ts runtime=E2E_context_tool_output
test("context-artifacts replacement reaches the unchanged transcript tool consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "ai-context-artifacts-native",
    "e2e.ai-context-artifacts",
    "src/artifacts.ts",
    (source) =>
      source.replace(
        "async readToolOutput(id, options = {}) {",
        'async readToolOutput(id, options = {}) {\n      if (id === "e2e-context") return { content: "E2E context provider", offset: 1, totalLines: 1, truncated: false };',
      ),
  );
  await expect
    .poll(() => invokeTool(page, "read_tool_output", { id: "e2e-context" }))
    .toMatchObject({ content: "E2E context provider" });
  await expectWholeFolderReplacementSelected(
    page,
    "ai-context-artifacts-native",
    "e2e.ai-context-artifacts",
  );
  await revertWholeFolderReplacement(
    page,
    "ai-context-artifacts-native",
    "e2e.ai-context-artifacts",
  );
  await expect
    .poll(() => invokeTool(page, "read_tool_output", { id: "e2e-context" }))
    .toMatchObject({ error: expect.stringContaining("no saved output") });
});

// @termco-certifies copy-replace ai-live-native source=src/registry.ts runtime=e2e-live_kind
test("AI live replacement reaches the unchanged chat session consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "ai-live-native",
    "e2e.ai-live",
    "src/registry.ts",
    (source) =>
      source.replace(
        "#lookup<K extends keyof AiLiveCapability>(key: K): AiLiveCapability[K] {",
        '#lookup<K extends keyof AiLiveCapability>(key: K): AiLiveCapability[K] {\n    if (key === "getActiveKind") return (() => "e2e-live") as AiLiveCapability[K];',
      ),
  );
  await expect
    .poll(() => liveKind(page))
    .toBe("e2e-live");
  await expectWholeFolderReplacementSelected(page, "ai-live-native", "e2e.ai-live");
  await revertWholeFolderReplacement(page, "ai-live-native", "e2e.ai-live");
  expect(await liveKind(page)).not.toBe("e2e-live");
});

// @termco-certifies copy-replace ai-speech-native source=src/speech.ts runtime=groq_only_configuration
test("AI speech replacement reaches the unchanged chat recording adapter", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "ai-speech-native",
    "e2e.ai-speech",
    "src/speech.ts",
    (source) =>
      source.replace(
        "return { configuredProviders };",
        'return { configuredProviders: ["groq"] };',
      ),
  );
  await expect
    .poll(() => speechConfiguration(page))
    .toEqual({ configuredProviders: ["groq"] });
  await expectWholeFolderReplacementSelected(
    page,
    "ai-speech-native",
    "e2e.ai-speech",
  );
  await revertWholeFolderReplacement(page, "ai-speech-native", "e2e.ai-speech");
  await expect
    .poll(() => speechConfiguration(page))
    .toMatchObject({ configuredProviders: expect.arrayContaining(["whispercpp"]) });
});

// @termco-certifies copy-replace ai-tools-ask-user-native source=src/tools.ts runtime=E2E_ask_user_description
test("Ask User tool replacement reaches the unchanged chat tool registry", async ({
  page,
  workspace,
}) => {
  await certifyToolDescription({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-tools-ask-user-native",
    replacementId: "e2e.ai-tools-ask-user",
    relativePath: "src/tools.ts",
    toolName: "ask_user",
    originalText: "Put ONE decision to the user",
    replacementText: "E2E ask user decision",
  });
});

// @termco-certifies copy-replace ai-tools-lsp-native source=src/tools.ts runtime=E2E_LSP_description
test("LSP tool replacement reaches the unchanged chat tool registry", async ({
  page,
  workspace,
}) => {
  await certifyToolDescription({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-tools-lsp-native",
    replacementId: "e2e.ai-tools-lsp",
    relativePath: "src/tools.ts",
    toolName: "lsp_diagnostics",
    originalText: "Get language-server diagnostics",
    replacementText: "E2E LSP diagnostics",
  });
});

// @termco-certifies copy-replace ai-tools-skill-native source=src/tools.ts runtime=E2E_skill_description
test("Skill tool replacement reaches the unchanged chat tool registry", async ({
  page,
  workspace,
}) => {
  await certifyToolDescription({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-tools-skill-native",
    replacementId: "e2e.ai-tools-skill",
    relativePath: "src/tools.ts",
    toolName: "skill",
    originalText: "Activate one enabled skill",
    replacementText: "E2E activate skill",
  });
});

// @termco-certifies copy-replace ai-tools-todo-native source=src/tools.ts runtime=E2E_todo_description
test("Todo tool replacement reaches the unchanged chat tool registry", async ({
  page,
  workspace,
}) => {
  await certifyToolDescription({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-tools-todo-native",
    replacementId: "e2e.ai-tools-todo",
    relativePath: "src/tools.ts",
    toolName: "todo_write",
    originalText: "Replace your current task list",
    replacementText: "E2E replace task list",
  });
});

// @termco-certifies copy-replace ai-tools-transcript-native source=src/tools.ts runtime=E2E_transcript_description
test("Transcript tool replacement reaches the unchanged chat tool registry", async ({
  page,
  workspace,
}) => {
  await certifyToolDescription({
    page,
    userData: workspace.userData,
    originalPluginId: "ai-tools-transcript-native",
    replacementId: "e2e.ai-tools-transcript",
    relativePath: "src/tools.ts",
    toolName: "read_tool_output",
    originalText: "Read the full output of an earlier tool call",
    replacementText: "E2E read parked tool output",
  });
});

const remainingToolCases = [
  {
    originalPluginId: "ai-tools-browser-native",
    replacementId: "e2e.ai-tools-browser-runtime",
    toolName: "browser_navigate",
    originalText: "Navigate the shared embedded browser",
    replacementText: "E2E navigate the shared embedded browser",
  },
  {
    originalPluginId: "ai-tools-containers-native",
    replacementId: "e2e.ai-tools-containers-runtime",
    toolName: "container_list",
    originalText: "List containers across Docker",
    replacementText: "E2E list containers across Docker",
  },
  {
    originalPluginId: "ai-tools-files-native",
    replacementId: "e2e.ai-tools-files-runtime",
    toolName: "read_file",
    originalText: "Read a UTF-8 text file",
    replacementText: "E2E read a UTF-8 text file",
  },
  {
    originalPluginId: "ai-tools-git-native",
    replacementId: "e2e.ai-tools-git-runtime",
    toolName: "git_status",
    originalText: "Show the current branch",
    replacementText: "E2E show the current branch",
  },
  {
    originalPluginId: "ai-tools-managed-agents-native",
    replacementId: "e2e.ai-tools-managed-agents-runtime",
    toolName: "spawn_coding_agent",
    originalText: "Spawn a coding agent in a new terminal tab",
    replacementText: "E2E spawn a coding agent in a new terminal tab",
  },
  {
    originalPluginId: "ai-tools-plugin-dev-native",
    replacementId: "e2e.ai-tools-plugin-dev-runtime",
    toolName: "plugin_catalog",
    originalText: "Search every plugin selected by the current profile",
    replacementText: "E2E search every plugin selected by the current profile",
  },
  {
    originalPluginId: "ai-tools-subagents-native",
    replacementId: "e2e.ai-tools-subagents-runtime",
    toolName: "run_subagent",
    originalText: "Spawn an isolated subagent",
    replacementText: "E2E spawn an isolated subagent",
  },
  {
    originalPluginId: "ai-tools-system-native",
    replacementId: "e2e.ai-tools-system-runtime",
    toolName: "notify_user",
    originalText: "Send an OS notification to the user",
    replacementText: "E2E send an OS notification to the user",
  },
  {
    originalPluginId: "ai-tools-terminal-native",
    replacementId: "e2e.ai-tools-terminal-runtime",
    toolName: "bash_run",
    originalText: "Run a foreground command in this chat session's persistent private shell",
    replacementText: "E2E run a foreground command in this chat session's persistent private shell",
  },
  {
    originalPluginId: "ai-tools-ui-native",
    replacementId: "e2e.ai-tools-ui-runtime",
    toolName: "show_ui",
    originalText: "Render a rich view in chat when the shape of the data carries meaning",
    replacementText: "E2E render a rich view in chat when the shape of the data carries meaning",
  },
  {
    originalPluginId: "ai-tools-workflows-native",
    replacementId: "e2e.ai-tools-workflows-runtime",
    toolName: "list_workflows",
    originalText: "List reusable command workflows",
    replacementText: "E2E list reusable command workflows",
  },
] as const;

// @termco-certifies copy-replace ai-tools-browser-native source=src/tools.ts runtime=E2E_browser_navigate_description
// @termco-certifies copy-replace ai-tools-containers-native source=src/tools.ts runtime=E2E_container_list_description
// @termco-certifies copy-replace ai-tools-files-native source=src/tools.ts runtime=E2E_read_file_description
// @termco-certifies copy-replace ai-tools-git-native source=src/tools.ts runtime=E2E_git_status_description
// @termco-certifies copy-replace ai-tools-managed-agents-native source=src/tools.ts runtime=E2E_spawn_agent_description
// @termco-certifies copy-replace ai-tools-plugin-dev-native source=src/tools.ts runtime=E2E_plugin_catalog_description
// @termco-certifies copy-replace ai-tools-subagents-native source=src/tools.ts runtime=E2E_subagent_description
// @termco-certifies copy-replace ai-tools-system-native source=src/tools.ts runtime=E2E_notify_description
// @termco-certifies copy-replace ai-tools-terminal-native source=src/tools.ts runtime=E2E_bash_run_description
// @termco-certifies copy-replace ai-tools-ui-native source=src/tools.ts runtime=E2E_show_ui_description
// @termco-certifies copy-replace ai-tools-workflows-native source=src/tools.ts runtime=E2E_workflow_description
for (const input of remainingToolCases) {
  test(`${input.originalPluginId} replacement reaches the unchanged chat tool registry`, async ({
    page,
    workspace,
  }) => {
    await certifyToolDescription({
      page,
      userData: workspace.userData,
      ...input,
      relativePath: "src/tools.ts",
    });
  });
}

// @termco-certifies copy-replace ai-tools-mcp-native source=src/tools.ts runtime=E2E_MCP_description
test("MCP tool replacement reaches a real connected tool in the unchanged chat registry", async ({
  page,
  workspace,
}) => {
  const server = {
    name: "fixture",
    command: process.execPath,
    args: [join(process.cwd(), "e2e", "fixtures", "mcp-stdio-server.mjs")],
  };
  await page.evaluate((configuration) =>
    window.__termco.capabilityCall({
      consumerPluginId: "ai-chat-native",
      capability: "ai.library",
      method: "addMcpServers",
      args: [[configuration]],
    }), server,
  );
  await expect
    .poll(() => toolDescription(page, "mcp__fixture__ping"))
    .toContain("Fixture MCP ping");

  await replaceSource(
    page,
    workspace.userData,
    "ai-tools-mcp-native",
    "e2e.ai-tools-mcp-runtime",
    "src/tools.ts",
    (source) =>
      source.replace(
        "definition.description ??",
        '"E2E MCP: " + (definition.description ??',
      ).replace(
        '`MCP tool "${definition.name}" from server "${server}".`,',
        '`MCP tool "${definition.name}" from server "${server}".`),',
      ),
  );
  await expect
    .poll(() => toolDescription(page, "mcp__fixture__ping"))
    .toContain("E2E MCP: Fixture MCP ping");
  await expectWholeFolderReplacementSelected(
    page,
    "ai-tools-mcp-native",
    "e2e.ai-tools-mcp-runtime",
  );
  await revertWholeFolderReplacement(
    page,
    "ai-tools-mcp-native",
    "e2e.ai-tools-mcp-runtime",
  );
  await expect
    .poll(() => toolDescription(page, "mcp__fixture__ping"))
    .toBe("Fixture MCP ping");
  await page.evaluate((name) =>
    window.__termco.capabilityCall({
      consumerPluginId: "ai-chat-native",
      capability: "ai.library",
      method: "removeMcpServer",
      args: [name],
    }), server.name,
  );
});
