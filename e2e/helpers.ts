/**
 * Shared E2E interactions (lightweight page objects) built on the real
 * accessible names / roles discovered from the running app.
 */
import { expect, type Page } from "@playwright/test";
import type {
  PluginCreateRequest,
  PluginCreateResult,
  PluginForkResult,
  PluginMutationResult,
} from "@termco/profile-base";
import type { UiContributionVerificationExpectation } from "@termco/ui-shell-base";
import { MOD } from "./fixtures";

/** Exercise the same mandatory authoring-plan boundary as the real Plugin
 * Creator. E2E tests must not use the removed pre-plan mutation signatures. */
export async function createPluginDraft(
  page: Page,
  request: PluginCreateRequest,
  contributions: readonly UiContributionVerificationExpectation[] = [],
): Promise<PluginCreateResult> {
  return page.evaluate(async ({ request, contributions }) => {
    const plan = await window.__termco.planPlugin({
      intent: "create",
      plugin: {
        id: request.id,
        name: request.name,
        description: request.description,
        category: request.category,
      },
      target: request.target,
      ...(request.variant ? { variant: request.variant } : {}),
      contributions,
      reveal: "none",
    });
    return window.__termco.createPlugin(plan.planId);
  }, { request, contributions });
}

export async function forkPluginDraft(
  page: Page,
  request: {
    pluginId: string;
    forkId: string;
    name?: string;
    target: PluginCreateRequest["target"];
    contributions?: readonly UiContributionVerificationExpectation[];
  },
): Promise<PluginForkResult> {
  return page.evaluate(async (request) => {
    const profile = await window.__termco.rendererPluginProfile();
    const source = profile.catalog.find((plugin) => plugin.id === request.pluginId);
    if (!source) throw new Error(`source plugin ${request.pluginId} was not found`);
    const plan = await window.__termco.planPlugin({
      intent: "fork",
      plugin: {
        id: request.forkId,
        name: request.name ?? `${source.name} Fork`,
        description: `Independent fork of ${source.name}.`,
        category: source.category,
      },
      sourcePluginId: request.pluginId,
      target: request.target,
      contributions: request.contributions ?? [],
      reveal: "none",
    });
    return window.__termco.forkPlugin(plan.planId);
  }, request);
}

export async function copyAndReplacePluginThroughPlan(
  page: Page,
  request: {
    pluginId: string;
    replacementId: string;
    name?: string;
    target?: PluginCreateRequest["target"];
  },
): Promise<PluginMutationResult> {
  return page.evaluate(async (request) => {
    const profile = await window.__termco.rendererPluginProfile();
    const source = profile.catalog.find((plugin) => plugin.id === request.pluginId);
    if (!source) throw new Error(`source plugin ${request.pluginId} was not found`);
    const target = request.target ?? (
      source.processes.includes("main")
        ? "main-provider"
        : source.processes.includes("server")
          ? "server"
          : "renderer-provider"
    );
    const plan = await window.__termco.planPlugin({
      intent: "replace",
      plugin: {
        id: request.replacementId,
        name: request.name ?? `${source.name} (Custom)`,
        description: `E2E whole-folder replacement of ${source.name}.`,
        category: source.category,
      },
      sourcePluginId: request.pluginId,
      target,
      contributions: [],
      reveal: "none",
    });
    const draft = await window.__termco.copyAndReplacePlugin(plan.planId);
    if (draft.status !== "draft") return draft;
    return window.__termco.applyPlugin(draft.pluginId);
  }, request);
}

/** Open a fresh blocks tab and run the first command through its input bar.
 * The shell input mounts lazily (Suspense) and grabs focus itself — clicking
 * it would only disturb that. Wait for the placeholder (editor mounted),
 * then type; if the keystrokes raced the focus handoff and no block card
 * materializes, clear the input and retry. */
export async function openBlocksTabAndRun(
  page: Page,
  command: string,
): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+t`);
  await page
    .getByText("Run a command", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(800);
  await expect
    .poll(
      async () => {
        // Drop any text a failed attempt left behind before retyping.
        await page.keyboard.press(`${MOD}+a`);
        await page.keyboard.press("Backspace");
        await page.keyboard.type(command);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1_200);
        return page.locator(".term-block").count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

export async function openFile(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).first().click();
  // The editor mounts a CodeMirror instance.
  await expect(page.locator(".cm-editor").first()).toBeVisible({ timeout: 15_000 });
}

export async function openSourceControl(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Source Control" }).first().click();
  // "Commit Graph" is always present once the source-control panel is mounted.
  await expect(page.getByRole("button", { name: /Commit Graph/ }).first())
    .toBeVisible({ timeout: 15_000 });
}

export async function openAiPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  // The dock now opens straight into the active conversation surface.
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
}

/** Open the AI panel and enter a conversation (reveals the composer). */
export async function openAiConversation(page: Page): Promise<void> {
  await openAiPanel(page);
  await page.waitForTimeout(600);
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+p`);
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 10_000 });
}

/** Prove that whole-folder replacement selected only the copied generation. */
export async function expectWholeFolderReplacementSelected(
  page: Page,
  originalPluginId: string,
  replacementPluginId: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const catalog = await page.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog,
      );
      return catalog.map((plugin) => plugin.id);
    })
    .toEqual(expect.arrayContaining([replacementPluginId]));

  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    catalog.find((plugin) => plugin.id === originalPluginId)?.enabled,
  ).toBe(false);
  expect(
    catalog.find((plugin) => plugin.id === replacementPluginId)?.enabled,
  ).not.toBe(false);
}

/** Revert a copied replacement through the public uninstall/profile transaction. */
export async function revertWholeFolderReplacement(
  page: Page,
  originalPluginId: string,
  replacementPluginId: string,
): Promise<void> {
  const result = await page.evaluate((pluginId) =>
    window.__termco.uninstallPlugin(pluginId), replacementPluginId,
  );
  expect(result.status).toBe("uninstalled");

  await expect
    .poll(async () => {
      const catalog = await page.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog,
      );
      return catalog.map((plugin) => plugin.id);
    })
    .toEqual(expect.arrayContaining([originalPluginId]));

  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(catalog.map((plugin) => plugin.id)).not.toContain(replacementPluginId);
}

export async function focusTerminalAndType(page: Page, text: string): Promise<void> {
  await page.locator("body").click();
  await page.keyboard.type(text);
}

/**
 * Enumerate visible interactive controls. A control is "labeled" if it has an
 * aria-label/title/text OR an icon (svg/img) — icon buttons are legitimate.
 * Returns totals so callers can assert breadth and near-zero truly-empty buttons.
 */
export async function inventoryControls(
  page: Page,
): Promise<{ total: number; unlabeled: string[] }> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"]',
      ),
    ).filter((b) => b.offsetParent !== null);
    // Only buttons/menuitems/tabs must be self-labeled; switches/sliders/checkboxes
    // are conventionally named via an associated <label>/aria-labelledby, which a
    // DOM-only probe can't resolve — flagging them would be false positives.
    // Switches/checkboxes/sliders/radios/options get their name from an
    // associated <label> (unresolvable via DOM alone) — exclude them even when
    // implemented as a <button role="switch">. Only real buttons/menuitems/tabs
    // must be self-labeled.
    const CONTEXT_NAMED = ["switch", "checkbox", "slider", "radio", "option"];
    const mustLabel = (b: Element) => {
      const role = b.getAttribute("role") || "";
      if (CONTEXT_NAMED.includes(role)) return false;
      return b.tagName === "BUTTON" || ["button", "menuitem", "tab"].includes(role);
    };
    const unlabeled = els
      .filter(mustLabel)
      .filter((b) => {
        const name = (
          b.getAttribute("aria-label") ||
          b.getAttribute("title") ||
          b.textContent ||
          ""
        ).trim();
        const labelledBy = b.getAttribute("aria-labelledby");
        const hasIcon = !!b.querySelector("svg, img");
        return name.length === 0 && !hasIcon && !labelledBy;
      })
      .map((b) => b.outerHTML.slice(0, 80));
    return { total: els.length, unlabeled };
  });
}
