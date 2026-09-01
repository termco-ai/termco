import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, MOD, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openFile,
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
    {
      pluginId: input.originalPluginId,
      replacementId: input.replacementId,
    },
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

// @termco-certifies copy-replace managed-agent-runtime-native source=src/runtime.ts runtime=e2e_managed_agent_result
test("managed-agent runtime replacement reaches the unchanged chat live consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "managed-agent-runtime-native",
    replacementId: "e2e.managed-agent-runtime",
    relativePath: "src/runtime.ts",
    edit: (source) =>
      source.replace(
        "spawnManagedAgent(prompt, sessionId) {",
        'spawnManagedAgent(prompt, sessionId) {\n      if (prompt === "e2e-managed-agent") return { tabId: 909, leafId: 919 };',
      ),
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const seam = (window as unknown as {
          __termcoE2E?: {
            aiSpawnManagedAgent?: (
              prompt: string,
              sessionId: string,
            ) => { tabId: number; leafId: number } | null;
          };
        }).__termcoE2E;
        return seam?.aiSpawnManagedAgent?.("e2e-managed-agent", "e2e-session");
      }),
    )
    .toEqual({ tabId: 909, leafId: 919 });
  await expectWholeFolderReplacementSelected(
    page,
    "managed-agent-runtime-native",
    "e2e.managed-agent-runtime",
  );
  await revertWholeFolderReplacement(
    page,
    "managed-agent-runtime-native",
    "e2e.managed-agent-runtime",
  );
});

// @termco-certifies copy-replace terminal-workspace-footer-native source=src/renderer.ts runtime=e2e_footer_integrator
test("terminal footer integrator replacement reaches the mounted workspace seam", async ({
  page,
  workspace,
}) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "terminal-workspace-footer-native",
    replacementId: "e2e.terminal-workspace-footer",
    relativePath: "src/renderer.ts",
    edit: (source) =>
      source.replace(
        "const footerId = () => footer.id;",
        'const footerId = () => "e2e-terminal-footer";',
      ),
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const seam = (window as unknown as {
          __termcoE2E?: { terminalWorkspaceFooterId?: () => string };
        }).__termcoE2E;
        return seam?.terminalWorkspaceFooterId?.();
      }),
    )
    .toBe("e2e-terminal-footer");
  await expectWholeFolderReplacementSelected(
    page,
    "terminal-workspace-footer-native",
    "e2e.terminal-workspace-footer",
  );
  await revertWholeFolderReplacement(
    page,
    "terminal-workspace-footer-native",
    "e2e.terminal-workspace-footer",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const seam = (window as unknown as {
          __termcoE2E?: { terminalWorkspaceFooterId?: () => string };
        }).__termcoE2E;
        return seam?.terminalWorkspaceFooterId?.();
      }),
    )
    .toBe("terminal-block-input");
});

async function showSelectionPopup(page: Page): Promise<void> {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press(`${MOD}+a`);
  const box = await editor.boundingBox();
  if (!box) throw new Error("editor has no visible bounds");
  await editor.dispatchEvent("mouseup", {
    bubbles: true,
    button: 0,
    clientX: box.x + Math.min(80, box.width / 2),
    clientY: box.y + Math.min(30, box.height / 2),
  });
}

// @termco-certifies copy-replace selection-ask-ai-native source=src/SelectionAskAi.tsx runtime=E2E_Ask_Termco
test("selection Ask AI replacement changes the real editor-selection overlay", async ({
  page,
  workspace,
}) => {
  await replaceSource({
    page,
    userData: workspace.userData,
    originalPluginId: "selection-ask-ai-native",
    replacementId: "e2e.selection-ask-ai",
    relativePath: "src/SelectionAskAi.tsx",
    edit: (source) => source.replace("<span>Ask Termco</span>", "<span>E2E Ask Termco</span>"),
  });
  await openFile(page, "notes.txt");
  await showSelectionPopup(page);
  await expect(
    page.getByRole("button", { name: /E2E Ask Termco/ }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    page,
    "selection-ask-ai-native",
    "e2e.selection-ask-ai",
  );
  await revertWholeFolderReplacement(
    page,
    "selection-ask-ai-native",
    "e2e.selection-ask-ai",
  );
  await showSelectionPopup(page);
  await expect(page.getByRole("button", { name: /^Ask Termco/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Ask Termco/ })).toHaveCount(0);
});
