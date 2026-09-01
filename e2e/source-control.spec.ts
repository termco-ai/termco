/**
 * Source control: the panel shows the branch and pending change, and supports the
 * stage → commit flow (real git module against the seeded repo). "Stage all
 * changes" is a checkbox; the Commit button enables once something is staged.
 */
import { expect, test } from "./fixtures";
import { openSourceControl } from "./helpers";

test("shows branch and the pending change", async ({ page }) => {
  await openSourceControl(page);
  await expect(page.getByRole("button", { name: "main", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt" }).first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Stage all changes" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Commit Graph/ }).first()).toBeVisible();
});

// Staging runs `git add` (async) and re-renders the panel, so the checkbox
// state flips after a round-trip — click + poll rather than check().
async function stageAll(page: import("@playwright/test").Page) {
  const cb = page.getByRole("checkbox", { name: "Stage all changes" }).first();
  await expect(cb).not.toBeChecked();
  await cb.click();
  await expect(cb).toBeChecked({ timeout: 10_000 });
}

test("staging marks the change as staged", async ({ page }) => {
  await openSourceControl(page);
  await stageAll(page);
  // With a change staged, entering a message enables the Commit button.
  await page.getByRole("textbox", { name: "Commit message" }).fill("staged via e2e");
  await expect(page.getByRole("button", { name: "Commit", exact: true }).first())
    .toBeEnabled({ timeout: 10_000 });
});

test("commits a staged change and clears it from the working set", async ({ page }) => {
  await openSourceControl(page);
  await stageAll(page);
  await page.getByRole("textbox", { name: "Commit message" }).fill("e2e: commit pending change");
  await page.getByRole("button", { name: "Commit", exact: true }).first().click();
  // The committed file drops out of the change list.
  await expect(page.getByRole("button", { name: "Discard notes.txt" }))
    .toBeHidden({ timeout: 15_000 });
});
