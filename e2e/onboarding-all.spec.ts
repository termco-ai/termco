import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openSettingsWindow, test } from "./fixtures";

type Interaction =
  | "agents-nav"
  | "agents-select"
  | "chat-agent"
  | "chat-model"
  | "chat-prompt"
  | "coding-autonomy"
  | "coding-backend"
  | "coding-new"
  | "coding-task"
  | "models-add"
  | "plugin-filter"
  | "profile-name"
  | "rig-new"
  | "rig-row";

type JourneyStep = {
  title: string;
  target?: string;
  interaction?: Interaction;
  optionalUnavailable?: string;
};

type JourneyAudit = {
  id: string;
  steps: readonly JourneyStep[];
};

const target = (id: string) => `[data-onboarding-target="${id}"]`;
const testId = (id: string) => `[data-testid="${id}"]`;

const journeys: readonly JourneyAudit[] = [
  {
    id: "termco.first-value",
    steps: [
      { title: "A developer workspace made from plugins" },
      { title: "Connect the model you want to use", target: target("models.overview") },
      { title: "Know where the work runs", target: target("header.rig-strip") },
      { title: "Learn each capability when it becomes relevant" },
    ],
  },
  {
    id: "models-settings.connect-a-model",
    steps: [
      { title: "Models are providers, not a Termco account", target: target("models.overview") },
      { title: "Choose sensible defaults", target: target("models.default") },
      { title: "Compare available model sources", target: target("models.add-provider"), interaction: "models-add" },
      { title: "Cloud, local, and compatible endpoints", target: target("models.catalog") },
    ],
  },
  {
    id: "ai-chat-native.first-request",
    steps: [
      { title: "A conversation beside the work", target: target("ai-chat.panel") },
      { title: "Choose how the AI should work", target: target("ai-chat.agent"), interaction: "chat-agent" },
      { title: "Pick the model for this request", target: target("ai-chat.model"), interaction: "chat-model" },
      { title: "Describe a concrete outcome", target: target("ai-chat.composer"), interaction: "chat-prompt" },
      { title: "Send, then review real tool work", target: target("ai-chat.send") },
    ],
  },
  {
    id: "agents-manager-native.choose-and-create",
    steps: [
      { title: "Your reusable AI library", target: target("agents-manager.overview") },
      { title: "Open the Agents library", target: target("agents-manager.section.agents"), interaction: "agents-nav" },
      { title: "Select an agent for Chat", target: target("agents-manager.agent-card"), interaction: "agents-select" },
      { title: "Create a role for your workflow", target: target("agents-manager.new-agent") },
    ],
  },
  {
    id: "plugin-manager-native.understand-and-adapt",
    steps: [
      { title: "The application is the plugin catalog", target: testId("plugins-section") },
      { title: "Inspect the live composition", target: testId("plugin-status-active"), interaction: "plugin-filter" },
      { title: "Every feature exposes its owner", target: '[data-testid^="profile-plugin-row-"]' },
      { title: "Change an existing feature safely", target: '[data-testid^="profile-plugin-copy-"]' },
    ],
  },
  {
    id: "plugin-manager-native.create-profile",
    steps: [
      { title: "A profile is a portable Termco composition", target: testId("profiles-section") },
      { title: "Name the setup your team will recognize", target: testId("profile-export-name"), interaction: "profile-name" },
      { title: "Export the reviewed package", target: testId("profile-export") },
      { title: "A teammate validates before activation", target: testId("profile-import") },
    ],
  },
  {
    id: "header-native.local-and-remote-rigs",
    steps: [
      { title: "A rig is a complete execution context", target: target("header.rig-strip") },
      { title: "Manage rigs and their tabs", target: target("header.rig-overview") },
      { title: "Inspect one rig", target: target("header.rig-row"), interaction: "rig-row" },
      { title: "Choose a new execution environment", target: target("header.new-rig"), interaction: "rig-new" },
      { title: "Start locally or connect a server", target: target("header.rig-types") },
    ],
  },
  {
    id: "containers-native.manage-runtime",
    steps: [
      {
        title: "Containers follow the active rig",
        target: '[data-contribution-service="ui.sidebar.views"][data-contribution-key="containers"]',
      },
      { title: "See runtime state without leaving the workspace", target: target("containers.panel") },
      {
        title: "Open details or act on a container",
        target: target("containers.card"),
        optionalUnavailable: "Start a local or remote container to continue this optional step.",
      },
    ],
  },
  {
    id: "workflows-native.create-and-run",
    steps: [
      { title: "Workflows live beside Chat and coding agents", target: target("ai-dock.mode.workflows") },
      { title: "Reuse a reviewed operational path", target: target("workflows.panel") },
      { title: "Author inputs instead of hiding shell strings", target: target("workflows.new") },
      { title: "Review before execution", target: target("workflows.run") },
    ],
  },
  {
    id: "coding-agent-native.run-and-control",
    steps: [
      { title: "Coding agents are a first-class Termco surface", target: target("ai-dock.mode.agents") },
      { title: "Runs and history follow the active rig", target: target("coding-agents.roster") },
      { title: "Configure a real run", target: target("coding-agents.new"), interaction: "coding-new" },
      { title: "Choose Claude Code or Codex", target: target("coding-agents.backend"), interaction: "coding-backend" },
      { title: "Set the approval boundary", target: target("coding-agents.autonomy"), interaction: "coding-autonomy" },
      { title: "Give the run an outcome", target: target("coding-agents.task"), interaction: "coding-task" },
      { title: "External agents can control Termco through MCP", target: target("coding-agents.external") },
    ],
  },
  {
    id: "termco.developer-story",
    steps: [
      { title: "Begin with a project rig", target: target("header.rig-strip") },
      { title: "Ask AI beside the code", target: target("ai-chat.panel") },
      { title: "Make the working mode explicit", target: target("agents-manager.overview") },
      { title: "Save the repeatable operation", target: target("workflows.panel") },
      { title: "Move the same workflow to a server", target: target("header.rig-overview") },
      { title: "Operate the active rig's containers", target: target("containers.panel") },
      { title: "Supervise coding agents inside Termco", target: target("coding-agents.roster") },
    ],
  },
  {
    id: "termco.extend-and-share",
    steps: [
      { title: "Start from the live plugin composition", target: testId("plugins-section") },
      { title: "Change an existing feature or create a new one", target: '[data-testid^="profile-plugin-copy-"]' },
      { title: "Create the company profile", target: testId("profiles-section") },
      { title: "Validate the handoff before activation", target: testId("profile-import") },
    ],
  },
];

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function performInteraction(page: Page, interaction: Interaction, highlighted: Locator) {
  switch (interaction) {
    case "agents-nav":
      await highlighted.click();
      return;
    case "agents-select":
      await highlighted.click();
      return;
    case "chat-agent":
      await highlighted.click();
      await page.getByRole("menuitem").first().click();
      return;
    case "chat-model":
      await highlighted.click();
      await page.locator("[data-model-row]").first().click();
      return;
    case "chat-prompt":
      await highlighted.fill("Inspect this project and explain how its API starts locally.");
      return;
    case "coding-new":
      await highlighted.click();
      return;
    case "coding-backend":
      await expect(highlighted.locator("button:enabled").first()).toBeVisible();
      await highlighted.locator("button:enabled").first().click();
      return;
    case "coding-autonomy":
      await highlighted.getByRole("button").last().click();
      return;
    case "coding-task":
      await highlighted.fill("Inspect the current change and propose a safe implementation plan.");
      return;
    case "models-add":
    case "plugin-filter":
    case "rig-new":
    case "rig-row":
      await highlighted.click();
      return;
    case "profile-name":
      await highlighted.fill("Platform Engineering");
  }
}

for (const journey of journeys) {
  test(`audits every step of ${journey.id}`, async ({ app, page }) => {
    test.setTimeout(120_000);
    const settings = await openSettingsWindow(app, page);
    await settings.getByRole("button", { name: "Getting started", exact: true }).first().click();
    const card = settings.getByTestId(`onboarding-journey-${journey.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Start" }).click();

    const coach = page.getByTestId("onboarding-coach-mark");
    const artifactDirectory = join("e2e/.output/onboarding-audit", slug(journey.id));
    mkdirSync(artifactDirectory, { recursive: true });

    for (const [index, step] of journey.steps.entries()) {
      await test.step(`${index + 1}. ${step.title}`, async () => {
        await expect(coach).toBeVisible();
        await expect(coach.getByRole("heading", { name: step.title })).toBeVisible();
        await expect(coach.getByText(`${index + 1} of ${journey.steps.length}`, { exact: false })).toBeVisible();
        const highlighted = step.target ? page.locator(step.target).first() : null;
        let unavailable = false;
        if (highlighted) {
          if (step.optionalUnavailable) {
            const message = coach.getByText(step.optionalUnavailable, { exact: false });
            await expect(highlighted.or(message).first()).toBeVisible();
            unavailable = !(await highlighted.isVisible());
          } else {
            await expect(coach.getByText("This feature is not available", { exact: false })).toHaveCount(0);
            await expect(highlighted).toBeVisible();
          }
          if (!unavailable) {
            const box = await highlighted.boundingBox();
            expect(box?.width ?? 0).toBeGreaterThan(4);
            expect(box?.height ?? 0).toBeGreaterThan(4);
          }
        }

        await page.waitForTimeout(150);
        await page.screenshot({
          path: join(artifactDirectory, `${String(index + 1).padStart(2, "0")}-${slug(step.title)}.png`),
        });

        if (unavailable) {
          await coach.getByRole("button", { name: "Skip" }).click();
        } else if (step.interaction && highlighted) {
          await performInteraction(page, step.interaction, highlighted);
        } else {
          await coach.getByRole("button", {
            name: index === journey.steps.length - 1 ? "Finish" : "Next",
          }).click();
        }
      });
    }

    await expect(coach).toHaveCount(0);
  });
}
