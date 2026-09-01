import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  copyAndReplacePluginThroughPlan,
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

// @termco-certifies copy-replace ai-chat-native source=src/store/store.ts runtime=miniOpen_true
test("AI sessions are source-owned and a copied provider replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.find((plugin) => plugin.id === "ai-chat-native"))
    .toMatchObject({
      id: "ai-chat-native",
      manifest: {
        schemaVersion: 3,
        id: "ai-chat-native",
        entrypoints: { renderer: "src/plugin.ts" },
      },
    });
  expect(profile.activationOrder).toContain("ai-chat-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-chat-native" }),
  );

  // Materialize a live Chat runtime so replacement must report and dispose it.
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 15_000 });
  await openCommandPalette(page);
  const palette = page.getByRole("dialog").first();
  const paletteInput = page.getByRole("combobox", { name: "Command palette" });
  await page.keyboard.type("settings");
  await expect(paletteInput).toHaveValue("settings");

  const copied = await copyAndReplacePluginThroughPlan(page, {
    pluginId: "ai-chat-native",
    replacementId: "e2e.ai-chat-native",
    target: "renderer-provider",
  });
  expect(copied.status).toBe("replaced");
  const replacementProfile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(replacementProfile.plugins.map((plugin) => plugin.id)).not.toContain(
    "ai-chat-native",
  );
  expect(
    replacementProfile.plugins.find(
      (plugin) => plugin.id === "e2e.ai-chat-native",
    ),
  ).toMatchObject({
    id: "e2e.ai-chat-native",
    manifest: {
      schemaVersion: 3,
      id: "e2e.ai-chat-native",
      replaces: "ai-chat-native",
      entrypoints: { renderer: "src/plugin.ts" },
    },
  });
  expect(replacementProfile.activationOrder).toContain("e2e.ai-chat-native");
  expect(replacementProfile.activationOrder).not.toContain("ai-chat-native");
  expect(replacementProfile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "e2e.ai-chat-native" }),
  );
  // Unrelated renderer plugins are adopted into the successor runtime. Their
  // live UI/state must not be torn down by an AI-provider replacement.
  await expect(palette).toBeVisible();
  await expect(paletteInput).toHaveValue("settings");
  await page.keyboard.press("Escape");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-chat-native",
  );
  const expectedSource = [
    "src/plugin.ts",
    "src/runtime.ts",
    "src/sessions.ts",
    "src/store/store.ts",
    "src/store/registry.ts",
    "src/store/types.ts",
  ];
  for (const relative of expectedSource) {
    expect(existsSync(join(source, relative)), relative).toBe(true);
  }
  const ownedCode = readdirSync(join(source, "src"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
  expect(ownedCode).not.toMatch(/from ["'](?:@\/|src\/|electron\/|@termco\/app\/)/);

  // Change real provider behavior, rebuild it, and observe the already-running
  // shell following the new store rather than the disposed original store.
  const storePath = join(source, "src", "store", "store.ts");
  const store = readFileSync(storePath, "utf8");
  const original = `togglePanel: () => {
    const state = useChatStore.getState();
    if (state.panelOpen || state.mini.open) {
      state.closePanel();
      state.closeMini();
      return;
    }
    if (publicComposerAvailable()) state.focusInput(null);
    else state.openPanel();
  },`;
  expect(store).toContain(original);
  writeFileSync(
    storePath,
    store.replace(
      original,
      `togglePanel: () => useChatStore.setState({ panelOpen: false, mini: { open: true } }),`,
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-chat-native"),
  );
  expect(reloaded.status).toBe("replaced");

  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect
    .poll(() => page.evaluate(() => window.__termcoE2E?.aiSessionState()))
    .toMatchObject({ miniOpen: true, panelOpen: false, keysLoaded: true });
  await expect(page.locator("[data-ai-mini-window]")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("ai-panel")).toBeHidden();
  await expectWholeFolderReplacementSelected(
    page,
    "ai-chat-native",
    "e2e.ai-chat-native",
  );

  await revertWholeFolderReplacement(
    page,
    "ai-chat-native",
    "e2e.ai-chat-native",
  );
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect
    .poll(() => page.evaluate(() => window.__termcoE2E?.aiSessionState()))
    .toMatchObject({ miniOpen: false, keysLoaded: true });
  await expect(page.locator("[data-ai-mini-window]")).toBeHidden();
});
