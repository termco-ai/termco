/**
 * Agents & Snippets manager: opens, lists agents/snippets, and exposes create
 * affordances. Covers the redesigned agents view (filter row, card grid,
 * read-only built-in viewer) and the new-agent editor modal.
 */
import { expect, test } from "./fixtures";

async function openManager(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  await page.waitForTimeout(800);
}

test("opens the Agents & Snippets manager with content", async ({ page }) => {
  await openManager(page);
  await expect(page.getByText(/Agents|Snippets/i).first()).toBeVisible({ timeout: 10_000 });
});

test("exposes a create/new affordance in the manager", async ({ page }) => {
  await openManager(page);
  await expect(
    page.getByRole("button", { name: /New|Add|Create|\+/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("shows the redesigned agents grid with filter row and cards", async ({ page }) => {
  await openManager(page);
  // Filter row: search input, pills, and the mono count label.
  await expect(page.getByPlaceholder("Filter agents…")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Built-in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Custom", exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ agents/)).toBeVisible();
  // Built-in cards carry a badge, tool chips, and a View affordance.
  const coder = page.locator("[data-agents-manager] [role=button]", { hasText: "Coder" }).first();
  await expect(coder).toBeVisible();
  await expect(coder.getByText("Built-in")).toBeVisible();
  await expect(coder.getByText("Standard tools")).toBeVisible();
  await expect(coder.getByRole("button", { name: "View" })).toBeVisible();
  await page.screenshot({ path: "e2e/.output/agents-view.png" });
});

test("filters agents by search and pills", async ({ page }) => {
  await openManager(page);
  const search = page.getByPlaceholder("Filter agents…");
  await search.fill("Architect");
  await expect(page.getByText("1 agent", { exact: true })).toBeVisible();
  await search.fill("zzz-nothing");
  await expect(page.getByText(/No agents match/)).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(page.getByText("0 agents", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText(/\d+ agents/)).toBeVisible();
});

test("opens built-in agents read-only and creates a custom agent", async ({ page }) => {
  await openManager(page);
  // Built-in: View opens the read-only editor.
  const coder = page.locator("[data-agents-manager] [role=button]", { hasText: "Coder" }).first();
  await coder.getByRole("button", { name: "View" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Built-in agent — read-only")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(dialog.getByPlaceholder("e.g. Docs writer")).toBeDisabled();
  await page.screenshot({ path: "e2e/.output/agent-viewer-builtin.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // New agent: fill the editor, restrict a tool group, save.
  await page.getByRole("button", { name: "New agent" }).first().click();
  await expect(dialog.getByText("New agent").first()).toBeVisible();
  await dialog.getByPlaceholder("e.g. Docs writer").fill("Docs writer");
  await dialog.getByPlaceholder("One line on what this agent is for").fill("Writes the docs.");
  await dialog.getByPlaceholder("You are a focused agent that…").fill("You write documentation.");
  await dialog.getByRole("button", { name: /Browser/ }).click();
  await page.screenshot({ path: "e2e/.output/agent-editor.png" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  // The card lands in the grid with a Custom badge and restricted tool chips.
  const card = page.locator("[data-agents-manager] [role=button]", { hasText: "Docs writer" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Custom")).toBeVisible();
  await expect(card.getByText("Browser")).toBeVisible();
  await expect(card.getByText("Standard tools")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.screenshot({ path: "e2e/.output/agents-view-with-custom.png" });
});
