import { _electron as electron, type Page } from "@playwright/test";
import {
  expect,
  MAIN,
  seedCustomEndpoint,
  seedWorkspace,
  test,
} from "./fixtures";
import { openAiConversation } from "./helpers";

const endpoint = {
  id: "local-context",
  name: "Test",
  baseURL: "http://localhost:20128/v1",
  modelId: "gh/gpt-5.6-sol",
  contextLimit: 1_000_000,
};

const contextTest = test.extend({
  workspace: async ({}, use) => {
    const workspace = seedWorkspace();
    seedCustomEndpoint(workspace, endpoint);
    await use(workspace);
  },
});

type ContextState = {
  modelId: string;
  contextLimit: number;
  thresholds: { warn: number; compact: number; blocked: number };
};

async function contextState(page: Page): Promise<ContextState> {
  return page.evaluate(() => {
    const seam = (window as unknown as {
      __termcoE2E?: { aiContextState?: () => ContextState };
    }).__termcoE2E;
    if (!seam?.aiContextState) throw new Error("AI context E2E seam is not active");
    return seam.aiContextState();
  });
}

async function setDefaultModel(page: Page, modelId: string): Promise<void> {
  await page.evaluate((id) => window.__termco.capabilityCall({
    consumerPluginId: "ai-chat-native",
    capability: "settings.preferences",
    method: "set",
    args: ["defaultModelId", id],
  }), modelId);
}

contextTest("custom endpoint context persists, displays, restores, and switches live", async ({
  app,
  page,
  workspace,
}) => {
  await expect.poll(() => contextState(page)).toMatchObject({
    modelId: "compat-local-context",
    contextLimit: 1_000_000,
  });
  const first = await contextState(page);
  expect(first.thresholds.warn).toBeGreaterThan(800_000);
  expect(first.thresholds.compact).toBeGreaterThan(first.thresholds.warn);

  await openAiConversation(page);
  await page.getByRole("img", { name: "Model context usage" }).hover();
  await expect(page.getByText(/0\s*\/\s*1M/).first()).toBeVisible();
  await expect(page.getByText("gh/gpt-5.6-sol").last()).toBeVisible();

  await setDefaultModel(page, "gpt-5.4-mini");
  await expect.poll(() => contextState(page)).toMatchObject({
    modelId: "gpt-5.4-mini",
    contextLimit: 400_000,
  });
  await setDefaultModel(page, "compat-local-context");
  await expect.poll(() => contextState(page)).toMatchObject({
    modelId: "compat-local-context",
    contextLimit: 1_000_000,
  });

  await app.close();
  const restarted = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_USER_DATA: workspace.userData,
      TERMCO_E2E: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const restoredPage = await restarted.firstWindow();
    await restoredPage.getByTestId("workspace").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await expect.poll(() => contextState(restoredPage)).toMatchObject({
      modelId: "compat-local-context",
      contextLimit: 1_000_000,
    });
  } finally {
    await restarted.close();
  }
});
