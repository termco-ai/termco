import { expect, MOD, test } from "./fixtures";
import type { Locator } from "@playwright/test";

async function expectPlacement(subject: Locator, other: Locator, position: string) {
  await expect.poll(async () => {
    const a = await subject.boundingBox();
    const b = await other.boundingBox();
    if (!a || !b) return false;
    if (position === "below") return a.y >= b.y + b.height - 1 && Math.abs(a.x - b.x) < 2;
    if (position === "above") return a.y + a.height <= b.y + 1 && Math.abs(a.x - b.x) < 2;
    if (position === "left") return a.x + a.width <= b.x + 1 && Math.abs(a.y - b.y) < 2;
    return a.x >= b.x + b.width - 1 && Math.abs(a.y - b.y) < 2;
  }).toBe(true);
}

test("snaps a dragged terminal below an edited file and rearranges both through the visual picker", async ({ page }, testInfo) => {
  await page.getByTestId("onboarding-offer").getByRole("button", { name: "Not now" }).click();
  const terminalTab = page.getByRole("tab").first();
  await page.getByRole("button", { name: "notes.txt", exact: true }).first().click();
  const editor = page.locator(".cm-editor:visible");
  await expect(editor).toBeVisible();
  await editor.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(" keep my changes");

  const tab = (await terminalTab.boundingBox())!;
  const workspace = (await page.locator("[data-workspace-surface]").boundingBox())!;
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  // The old implementation misclassified this lower-right location as right.
  await page.mouse.move(workspace.x + workspace.width * 0.7, workspace.y + workspace.height - 20, { steps: 12 });
  const indicator = page.getByTestId("tab-split-drop-indicator");
  await expect(indicator).toHaveAttribute("data-dock-position", "bottom");
  const preview = (await indicator.boundingBox())!;
  expect(preview.y).toBeGreaterThan(workspace.y + workspace.height * 0.45);
  expect(preview.width).toBeGreaterThan(workspace.width * 0.95);
  await page.screenshot({ path: testInfo.outputPath("snap-preview.png") });
  await page.mouse.up();

  const terminalPanel = page.locator('[id="ws-right"]');
  const editorPanel = page.locator('[id="ws-left"]');
  await expectPlacement(terminalPanel, editorPanel, "below");
  await expect(editor).toContainText("keep my changes");
  const terminal = terminalPanel.locator("[data-terminal-padding]:visible");
  await expect(terminal).toContainText("%", { timeout: 20_000 });
  await terminal.click();
  await page.keyboard.type("echo SNAP_SESSION_SURVIVES");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("SNAP_SESSION_SURVIVES");

  // A docked pane can be grabbed directly by its title, repeatedly, without
  // returning to the top tab strip or interrupting the running shell.
  for (const [pane, other, positions] of [
    [terminalPanel, editorPanel, ["right", "above", "left", "below"]],
    [editorPanel, terminalPanel, ["left", "above", "right", "below"]],
  ] as const) {
    for (const position of positions) {
      const header = (await pane.locator("[data-pane-drag-handle]").boundingBox())!;
      const area = (await page.locator("[data-workspace-surface]").boundingBox())!;
      const x = area.x + (position === "left" ? 20 : position === "right" ? area.width - 20 : area.width / 2);
      const y = area.y + (position === "above" ? 10 : position === "below" ? area.height - 20 : area.height / 2);
      await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 12 });
      await expect(page.getByTestId("pane-dock-drop-indicator")).toHaveAttribute("data-dock-position",
        position === "above" ? "top" : position === "below" ? "bottom" : position);
      await page.mouse.up();
      await expectPlacement(pane, other, position);
      await expect(editor).toContainText("keep my changes");
      await expect(terminal).toContainText("SNAP_SESSION_SURVIVES");
    }
  }

  // Escape releases pointer capture and leaves the current placement intact.
  const placedHeader = (await terminalPanel.locator("[data-pane-drag-handle]").boundingBox())!;
  await page.mouse.move(placedHeader.x + placedHeader.width / 2, placedHeader.y + placedHeader.height / 2);
  await page.mouse.down();
  await page.mouse.move(workspace.x + workspace.width - 20, workspace.y + workspace.height / 2, { steps: 12 });
  await expect(page.getByTestId("pane-dock-drop-indicator")).toHaveAttribute("data-dock-position", "right");
  await page.screenshot({ path: testInfo.outputPath("pane-redock-preview.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pane-dock-drop-indicator")).toHaveCount(0);
  await page.mouse.up();
  await expectPlacement(terminalPanel, editorPanel, "above");

  // The terminal is still interactive after repeated movement.
  await terminal.click();
  await page.keyboard.type("echo PANE_DRAG_COMPLETE");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("PANE_DRAG_COMPLETE");

  for (const position of ["left", "right", "above", "below"]) {
    await page.getByRole("button", { name: "Arrange tabs", exact: true }).click();
    if (position === "left") {
      await expect(page.getByRole("button", { name: "Place tab below", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("layout-picker.png"), animations: "disabled" });
    }
    await page.getByRole("button", { name: `Place tab ${position}`, exact: true }).click();
    await expectPlacement(terminalPanel, editorPanel, position);
    await expect(editor).toContainText("keep my changes");
    await expect(terminal).toContainText("SNAP_SESSION_SURVIVES");
  }

  // Moving the primary editor itself must preserve its buffer and pane host.
  await page.getByRole("tab", { name: /notes.txt/ }).click();
  await page.getByRole("button", { name: "Arrange tabs", exact: true }).click();
  await page.getByRole("button", { name: "Place tab below", exact: true }).click();
  await expectPlacement(editorPanel, terminalPanel, "below");
  await expect(editor).toContainText("keep my changes");
  await editor.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+z`);
  await expect(editor).not.toContainText("keep my changes");
});
