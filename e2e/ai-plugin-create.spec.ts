import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, openSettingsWindow, test } from "./fixtures";
import { createPluginDraft, forkPluginDraft } from "./helpers";

async function invokeAiTool<T>(
  page: import("@playwright/test").Page,
  name: string,
  input: unknown,
): Promise<T> {
  return page.evaluate(
    ({ name, input }) => {
      const seam = (window as unknown as {
        __termcoE2E?: {
          aiInvokeTool?: (toolName: string, toolInput: unknown) => Promise<unknown>;
        };
      }).__termcoE2E;
      if (!seam?.aiInvokeTool) throw new Error("AI tool E2E seam is unavailable");
      return seam.aiInvokeTool(name, input) as Promise<T>;
    },
    { name, input },
  );
}

async function completeInteractiveTool(
  page: import("@playwright/test").Page,
  name: string,
  input: unknown,
  output: unknown,
): Promise<string> {
  return page.evaluate(
    ({ name, input, output }) => {
      const seam = (window as unknown as {
        __termcoE2E?: {
          aiCompleteInteractiveTool?: (
            toolName: string,
            toolInput: unknown,
            toolOutput: unknown,
          ) => string;
        };
      }).__termcoE2E;
      if (!seam?.aiCompleteInteractiveTool) {
        throw new Error("AI interactive-tool E2E seam is unavailable");
      }
      return seam.aiCompleteInteractiveTool(name, input, output);
    },
    { name, input, output },
  );
}

const calculatorOverlaySource = `import type { PluginModule } from "@termco/kernel";
import { UI_OVERLAYS_SERVICE, type UiOverlayContribution, type UiOverlayRegistry } from "@termco/ui-overlays-base";
import { createElement, useState } from "react";

function CalculatorFab() {
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState("");
  const fixed = { position: "fixed", right: 24, zIndex: 1000 } as const;
  const choices = ["Basic calculator", "Scientific calculator", "Programmer calculator"];
  return createElement("div", { "data-calculator-fab": true },
    active ? createElement("section", {
      role: "dialog",
      "aria-label": active,
      style: { ...fixed, bottom: 160, width: 260, padding: 16, borderRadius: 14, background: "var(--background)", border: "1px solid var(--border)", boxShadow: "0 16px 40px rgb(0 0 0 / .3)" },
    }, createElement("strong", null, active), createElement("button", { type: "button", "aria-label": "Close calculator", onClick: () => setActive("") }, "Close")) : null,
    menu ? createElement("nav", { "aria-label": "Calculator choices", style: { ...fixed, bottom: 110, display: "flex", gap: 8 } },
      ...choices.map((choice) => createElement("button", { key: choice, type: "button", "aria-label": choice, onClick: () => { setActive(choice); setMenu(false); } }, choice)),
    ) : null,
    createElement("button", {
      type: "button",
      "aria-label": "Calculator FAB",
      onClick: () => setMenu((value) => !value),
      style: { ...fixed, bottom: 48, minWidth: 56, minHeight: 56, borderRadius: 999, background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "0 16px 40px rgb(0 0 0 / .3)", cursor: "pointer" },
    }, "Calculator"),
  );
}

const plugin: PluginModule = {
  inject: [UI_OVERLAYS_SERVICE],
  async activate(context) {
    const contribution: UiOverlayContribution = { id: "e2e.standalone-overlay", label: "Calculator FAB", description: "E2E calculator", Component: CalculatorFab };
    await context.effect(() => context.get<UiOverlayRegistry>(UI_OVERLAYS_SERVICE).register(contribution, { pluginId: context.pluginId, generation: context.generation, key: contribution.id }));
  },
};
export default plugin;
`;

const sidebarCounterSource = `import type { PluginModule } from "@termco/kernel";
import { UI_SIDEBAR_VIEWS_SERVICE, type UiSidebarViewContribution, type UiSidebarViewRegistry } from "@termco/ui-sidebar-base";
import { ONBOARDING_REGISTRY_SERVICE, contributeOnboarding, domOnboardingTarget } from "@termco/onboarding-base";
import { PuzzleIcon } from "@hugeicons/core-free-icons";
import { createElement, useState } from "react";

function CounterView() {
  const [count, setCount] = useState(0);
  return createElement("section", { "aria-label": "E2E Sidebar Calculator" },
    createElement("h2", null, "E2E Sidebar Calculator"),
    createElement("output", { role: "status", "aria-live": "polite" }, \`Counter: \${count}\`),
    createElement("button", { type: "button", "data-onboarding": "e2e-sidebar-counter-increment", onClick: () => setCount((value) => value + 1) }, "Increment QA counter"),
  );
}

const plugin: PluginModule = {
  inject: [UI_SIDEBAR_VIEWS_SERVICE],
  optionalInject: [ONBOARDING_REGISTRY_SERVICE],
  async activate(context) {
    const contribution: UiSidebarViewContribution = {
      id: "e2e.sidebar-calculator",
      label: "E2E Sidebar Calculator",
      description: "A new independent calculator view in the left sidebar.",
      icon: PuzzleIcon,
      Component: CounterView,
    };
    await context.effect(() => context.get<UiSidebarViewRegistry>(UI_SIDEBAR_VIEWS_SERVICE).register(contribution, {
      pluginId: context.pluginId,
      generation: context.generation,
      key: contribution.id,
    }));
    contributeOnboarding(context, {
      id: "e2e.sidebar-calculator-guidance",
      journeys: [{
        id: "e2e-sidebar-calculator-getting-started",
        title: "Try the sidebar calculator",
        description: "Open the calculator and increment its visible counter.",
        presentation: "contextual",
        steps: [{
          id: "increment-counter",
          version: 1,
          title: "Increment the QA counter",
          kind: "interaction",
          scope: { kind: "user" },
          targetId: "e2e-sidebar-counter-increment",
          expectation: { kind: "click" },
          body: { markdown: "Choose Increment QA counter and watch its status change." },
        }],
      }],
      targets: [domOnboardingTarget({
        id: "e2e-sidebar-counter-increment",
        label: "Increment QA counter",
        reveal: () => {
          const rail = Array.from(document.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "E2E Sidebar Calculator");
          if (rail instanceof HTMLElement) rail.click();
        },
        element: () => document.querySelector('[data-onboarding="e2e-sidebar-counter-increment"]') as HTMLElement | null,
      })],
    });
  },
};
export default plugin;
`;

test("creates an independent visible overlay without replacing an existing plugin", async ({
  page,
}) => {
  const before = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map(
      (plugin) => plugin.id,
    ),
  );

  const result = await createPluginDraft(page, {
    id: "e2e.standalone-overlay",
    name: "E2E Standalone Overlay",
    description: "Visible proof of independent plugin creation.",
    category: "Interface",
    target: "ui.overlays",
  }, [{
    contribution: { service: "ui.overlays", key: "e2e.standalone-overlay" },
    present: true,
    visibleTarget: { role: "button", name: "Calculator FAB" },
  }]);
  expect(result).toMatchObject({
    status: "draft",
    pluginId: "e2e.standalone-overlay",
    stages: {
      profileCommitted: false,
      graphSettled: false,
    },
  });

  const overlay = page.getByRole("button", { name: "E2E Standalone Overlay" });
  await expect(overlay).toHaveCount(0);

  const whileDraft = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map(
      (plugin) => plugin.id,
    ),
  );
  expect(whileDraft).toEqual(before);

  await page.evaluate((content) =>
    window.__termco.writePluginSourceFile(
      "e2e.standalone-overlay",
      "src/renderer.ts",
      content,
    ), calculatorOverlaySource);
  await expect(page.evaluate(() =>
    window.__termco.applyPlugin("e2e.standalone-overlay"),
  )).resolves.toMatchObject({ status: "replaced" });

  const after = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map(
      (plugin) => plugin.id,
    ),
  );
  expect(after).toEqual([...before, "e2e.standalone-overlay"]);
  expect(after).toContain("selection-ask-ai-native");

  const fab = page.getByRole("button", { name: "Calculator FAB" });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveScreenshot("calculator-fab.png", {
    animations: "disabled",
  });
  await fab.click();
  const radialMenu = page.getByRole("navigation", {
    name: "Calculator choices",
  });
  await expect(radialMenu).toHaveScreenshot("calculator-radial-menu.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Basic calculator" }).click();
  await expect(page.getByRole("dialog", { name: "Basic calculator" }))
    .toHaveScreenshot("calculator-dialog.png", { animations: "disabled" });
  await page.getByRole("button", { name: "Close calculator" }).click();
  for (const calculator of [
    "Scientific calculator",
    "Programmer calculator",
  ]) {
    await fab.click();
    await page.getByRole("button", { name: calculator }).click();
    await expect(page.getByRole("dialog", { name: calculator })).toBeVisible();
    await page.getByRole("button", { name: "Close calculator" }).click();
  }

  await page.reload();
  await page.getByTestId("workspace").waitFor({ state: "visible" });
  await expect(fab).toBeVisible();
  await page.getByTestId("workspace").evaluate((element) => {
    element.setAttribute("data-fab-shell-sentinel", "preserved");
  });

  const disabled = await page.evaluate(async () => {
    const impact = await window.__termco.previewPluginEnabled(
      "e2e.standalone-overlay",
      false,
    );
    return window.__termco.setPluginEnabled("e2e.standalone-overlay", false, {
      previewId: impact.previewId,
      generation: impact.generation,
    });
  });
  expect(disabled).toMatchObject({ status: "replaced", enabled: false });
  await expect(fab).toHaveCount(0);
  await expect(page.locator('[data-fab-shell-sentinel="preserved"]')).toHaveCount(1);
  expect(await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog.find(
      (plugin) => plugin.id === "selection-ask-ai-native",
    )?.enabled,
  )).toBe(true);

  await page.evaluate(async () => {
    const impact = await window.__termco.previewPluginEnabled(
      "e2e.standalone-overlay",
      true,
    );
    await window.__termco.setPluginEnabled("e2e.standalone-overlay", true, {
      previewId: impact.previewId,
      generation: impact.generation,
    });
  });
  await expect(fab).toBeVisible();

  await expect(page.evaluate(() =>
    window.__termco.uninstallPlugin("e2e.standalone-overlay"),
  )).resolves.toMatchObject({ status: "uninstalled" });
  await expect(fab).toHaveCount(0);
  expect(await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog.find(
      (plugin) => plugin.id === "selection-ask-ai-native",
    )?.enabled,
  )).toBe(true);
});

test("Plugin Creator tools create, verify, reveal, show again, and undo an independent sidebar view", async ({
  app,
  page,
}) => {
  const pluginId = "e2e.sidebar-calculator";
  const pluginName = "E2E Sidebar Calculator";
  const before = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map((row) => row.id)
  );

  const authoring = {
    intent: "create",
    plugin: {
      id: pluginId,
      name: pluginName,
      description: "A new independent calculator view in the left sidebar.",
      category: "Interface",
    },
    target: "ui.sidebar.views",
    contributions: [{
      contribution: { service: "ui.sidebar.views", key: pluginId },
      present: true,
      visibleTarget: { role: "button", name: pluginName },
      actions: [
        { kind: "activate" },
        {
          kind: "click",
          target: { role: "button", name: "Increment QA counter" },
        },
      ],
      after: [
        { selectedContribution: pluginId },
        { role: "heading", name: pluginName, visible: true },
        { role: "status", name: "Counter: 1", visible: true },
      ],
    }],
    reveal: "auto",
  };
  const onboarding = {
    decision: "include",
    rationale: "The new sidebar interaction is best learned in context.",
    journey: {
      id: "e2e-sidebar-calculator-getting-started",
      title: "Try the sidebar calculator",
      description: "Open the calculator and increment its visible counter.",
      presentation: "contextual",
      steps: [{
        id: "increment-counter",
        version: 1,
        title: "Increment the QA counter",
        kind: "interaction",
        instruction: "Choose Increment QA counter and watch its status change.",
        targetId: "e2e-sidebar-counter-increment",
        expectation: { kind: "click" },
      }],
    },
  };
  await completeInteractiveTool(page, "plugin_brief", {
    revision: 1,
    title: pluginName,
    outcome: "A developer can use a counter without leaving the workspace.",
    userJourney: "Open the independent sidebar, increment the counter, and keep working.",
    experience: {
      location: "A new left-sidebar view",
      interaction: "Open the view and increment its visible QA counter.",
      states: ["Counter at zero", "Counter incremented"],
    },
    scope: {
      included: ["Independent sidebar contribution", "Interactive counter"],
      excluded: ["Replacing an existing feature"],
    },
    acceptanceCriteria: [
      "The sidebar control opens the plugin-owned view.",
      "Incrementing the counter visibly changes its status to Counter: 1.",
    ],
    onboarding,
    authoring,
  }, { action: "confirm" });
  const plan = await invokeAiTool<{
    planId: string;
    intent: string;
    target: string;
  }>(page, "plugin_plan", {});
  expect(plan).toMatchObject({
    planId: expect.any(String),
    intent: "create",
    target: "ui.sidebar.views",
  });

  await expect(invokeAiTool(page, "plugin_create", {
    planId: plan.planId,
  })).resolves.toMatchObject({
    status: "draft",
    pluginId,
    stages: { profileCommitted: false, graphSettled: false },
  });
  await expect(page.getByRole("button", { name: pluginName })).toHaveCount(0);
  expect(await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map((row) => row.id)
  )).toEqual(before);

  await page.evaluate(
    ({ pluginId, source }) => window.__termco.writePluginSourceFile(
      pluginId,
      "src/renderer.ts",
      source,
    ),
    { pluginId, source: sidebarCounterSource },
  );

  const applied = await invokeAiTool<{
    status: string;
    completionId: string;
    generation: string;
  }>(page, "plugin_apply", { pluginId });
  expect(applied).toMatchObject({
    status: "replaced",
    completionId: expect.any(String),
    generation: expect.stringMatching(/^sha256-/),
  });

  const sidebarWidth = () => page
    .getByRole("navigation", { name: "Workspace tools" })
    .evaluate((rail) => rail.parentElement?.getBoundingClientRect().width ?? 0);
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect.poll(sidebarWidth).toBeLessThan(80);

  const completion = await invokeAiTool<{
    kind: string;
    status: string;
    ok: boolean;
    actions: string[];
    stages: string[];
    onboarding: { ok: boolean; decision: string; journeyId: string };
  }>(page, "plugin_verify", { completionId: applied.completionId });
  expect(completion, JSON.stringify(completion, null, 2)).toMatchObject({
    kind: "plugin-completion",
    status: "verified",
    ok: true,
    actions: ["show-again", "open-folder", "disable", "undo"],
    onboarding: {
      ok: true,
      decision: "include",
      journeyId: "e2e-sidebar-calculator-getting-started",
    },
  });
  expect(completion.stages).toEqual(expect.arrayContaining([
    "contribution-registered",
    "surface-mounted",
    "visible-target",
    "interaction",
    "postcondition",
  ]));

  const railButton = page.getByRole("button", { name: pluginName });
  await expect(railButton).toBeVisible();
  await expect(railButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(sidebarWidth).toBeGreaterThan(200);
  await expect(page.getByRole("heading", { name: pluginName })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Counter: 1");

  await expect(invokeAiTool(page, "plugin_reveal_change", {
    completionId: applied.completionId,
    service: "ui.sidebar.views",
    key: pluginId,
    mode: "show-and-spotlight",
    announcement: `${pluginName} is ready.`,
  })).resolves.toMatchObject({
    completionId: applied.completionId,
    results: [{ status: "revealed" }],
  });
  await expect(railButton).toHaveAttribute("data-plugin-change-reveal", /active|static/);

  // The same verified completion can safely drive the completion card's
  // Show-again action without re-running or recreating the contribution.
  await expect(invokeAiTool(page, "plugin_reveal_change", {
    completionId: applied.completionId,
    service: "ui.sidebar.views",
    key: pluginId,
    mode: "show-and-spotlight",
    announcement: `${pluginName} is ready.`,
  })).resolves.toMatchObject({ results: [{ status: "revealed" }] });
  await expect(railButton).toHaveAttribute("aria-pressed", "true");

  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Getting started", exact: true }).first().click();
  const onboardingCard = settings.getByTestId(
    "onboarding-journey-e2e-sidebar-calculator-getting-started",
  );
  await expect(onboardingCard).toBeVisible();
  await expect(onboardingCard.getByText("Try the sidebar calculator")).toBeVisible();
  await onboardingCard.getByRole("button", { name: "Start" }).click();
  await expect(settings.getByTestId("onboarding-coach-mark").getByRole("heading", {
    name: "Increment the QA counter",
  })).toBeVisible();
  await settings.getByTestId("onboarding-coach-mark").getByRole("button", {
    name: "Close onboarding",
  }).click();

  await expect(invokeAiTool(page, "plugin_undo", {
    completionId: applied.completionId,
  })).resolves.toMatchObject({
    status: "replaced",
    completionId: applied.completionId,
  });
  await expect(railButton).toHaveCount(0);
  expect(await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).plugins.map((row) => row.id)
  )).toEqual(before);
});

test("forks independently without disabling or replacing the source", async ({ page }) => {
  const result = await forkPluginDraft(page, {
    pluginId: "rigs-commands",
    forkId: "e2e.rigs-commands-fork",
    name: "E2E Rig Commands Fork",
    target: "ui.commands",
  });
  expect(result).toMatchObject({
    status: "forked",
    pluginId: "e2e.rigs-commands-fork",
  });

  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(catalog.find((plugin) => plugin.id === "rigs-commands")).toMatchObject({
    enabled: true,
  });
  expect(catalog.find((plugin) => plugin.id === "e2e.rigs-commands-fork"))
    .toBeUndefined();

  const manifest = await page.evaluate(async () => JSON.parse(
    await window.__termco.readPluginSourceFile(
      "e2e.rigs-commands-fork",
      "termco-plugin.json",
    ),
  ));
  expect(manifest).toMatchObject({
    id: "e2e.rigs-commands-fork",
    forkedFrom: "rigs-commands",
  });
  expect(manifest).not.toHaveProperty("replaces");
});

test("invalid creation and failed activation leave no orphan or broken graph", async ({
  page,
  workspace,
}) => {
  await expect(createPluginDraft(page, {
    id: "INVALID PLUGIN ID",
    name: "Invalid",
    description: "Must be rejected before scaffolding.",
    category: "Testing",
    target: "ui.overlays",
  })).rejects.toThrow(/id/i);
  expect(existsSync(join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "INVALID PLUGIN ID",
  ))).toBe(false);

  await createPluginDraft(page, {
    id: "e2e.activation-rollback",
    name: "Activation Rollback",
    description: "Keeps the previous graph live after a failed edit.",
    category: "Testing",
    target: "ui.overlays",
  });
  const previous = page.getByRole("button", { name: "Activation Rollback" });
  await expect(previous).toHaveCount(0);
  await page.evaluate(() => window.__termco.writePluginSourceFile(
    "e2e.activation-rollback",
    "src/renderer.ts",
    "this is not valid TypeScript {{{",
  ));
  await expect(page.evaluate(() =>
    window.__termco.applyPlugin("e2e.activation-rollback"),
  )).rejects.toThrow(/compile|build|expected|syntax/i);
  await expect(previous).toHaveCount(0);

  await page.evaluate(() => window.__termco.writePluginSourceFile(
    "e2e.activation-rollback",
    "src/renderer.ts",
    `import type { PluginModule } from "@termco/kernel";
const plugin: PluginModule = { activate() { throw new Error("e2e candidate activation failure"); } };
export default plugin;`,
  ));
  await expect(page.evaluate(() =>
    window.__termco.applyPlugin("e2e.activation-rollback"),
  )).rejects.toThrow(/candidate activation failure|activation/i);

  await expect(previous).toHaveCount(0);
  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(catalog.filter((plugin) => plugin.id === "e2e.activation-rollback"))
    .toHaveLength(0);
  await expect(page.getByTestId("workspace")).toBeVisible();
});
