import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace command-palette-native source=src/palette/CommandPalette.tsx runtime=E2E_replacement_palette
test("the categorized explanatory palette is source-owned and replaces live", async ({ page, workspace }) => {
  await openCommandPalette(page);
  const palette = page.getByTestId("command-palette-source");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(dialog.getByText("Commands", { exact: true })).toBeVisible();
  await page.keyboard.type("previous shell command");
  await expect(
    dialog.getByRole("option", { name: /Search command history/i }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "command-palette-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "command-palette-native",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "command-palette-native",
  );
  expect(profile.activationOrder).toContain("command-palette-native");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "command-palette-native",
    replacementId: "e2e.command-palette",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.command-palette");
  const renderer = join(source, "src", "palette", "CommandPalette.tsx");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  expect(existsSync(renderer)).toBe(true);
  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8").replace(
      "Type a command, > for history, # to find in files",
      "E2E replacement palette…",
    ),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.command-palette"));
  expect(apply.status).toBe("replaced");
  await openCommandPalette(page);
  await expect(page.getByRole("combobox", { name: "Command palette" })).toHaveAttribute("placeholder", "E2E replacement palette…");
  await expectWholeFolderReplacementSelected(
    page,
    "command-palette-native",
    "e2e.command-palette",
  );
  await page.keyboard.press("Escape");

  await revertWholeFolderReplacement(
    page,
    "command-palette-native",
    "e2e.command-palette",
  );
  await openCommandPalette(page);
  await expect(page.getByRole("combobox", { name: "Command palette" }))
    .toHaveAttribute(
      "placeholder",
      "Type a command, > for history, # to find in files",
    );
});

// @termco-certifies copy-replace command-palette-state-native source=src/state.ts runtime=e2e-state_query
test("the shared command-palette state provider replaces behind the unchanged overlay", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "command-palette-state-native",
      replacementId: "e2e.command-palette-state",
    }),
  );
  expect(result.status).toBe("replaced");

  const stateSource = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.command-palette-state",
    "src",
    "state.ts",
  );
  expect(existsSync(stateSource)).toBe(true);
  const original = readFileSync(stateSource, "utf8");
  const edited = original.replace(
    ': mode === "help"\n                ? "?"\n                : "",',
    ': mode === "help"\n                ? "?"\n                : "e2e-state",',
  );
  expect(edited).not.toBe(original);
  writeFileSync(stateSource, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.command-palette-state"),
  );
  expect(apply.status).toBe("replaced");
  await openCommandPalette(page);
  await expect(page.getByRole("combobox", { name: "Command palette" }))
    .toHaveValue("e2e-state");
  await expectWholeFolderReplacementSelected(
    page,
    "command-palette-state-native",
    "e2e.command-palette-state",
  );
  await page.keyboard.press("Escape");

  await revertWholeFolderReplacement(
    page,
    "command-palette-state-native",
    "e2e.command-palette-state",
  );
  await openCommandPalette(page);
  await expect(page.getByRole("combobox", { name: "Command palette" }))
    .toHaveValue("");
});
