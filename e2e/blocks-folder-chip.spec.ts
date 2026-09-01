/**
 * Folder chips on `ls` blocks: clicking a directory chip must reveal the
 * folder in the sidebar explorer (expand + select), not hand it to the OS
 * file manager. Regression context: over ssh (or with the explorer rooted at
 * "/") the old path check never matched, so every folder chip fell back to
 * the LOCAL Finder — with a remote path.
 */
import { expect, test } from "./fixtures";
import { openBlocksTabAndRun } from "./helpers";

test("clicking a folder chip reveals the folder in the sidebar explorer", async ({
  page,
}) => {
  // The seeded workspace has src/index.ts; `ls` renders a "src" dir chip.
  await openBlocksTabAndRun(page, "ls");
  const srcChip = page.locator(".tb-chip", { hasText: "src" }).first();
  await expect(srcChip).toBeVisible({ timeout: 20_000 });

  // The explorer shows src collapsed — index.ts is not in the tree yet.
  await expect(page.locator('[data-fs-path$="src/index.ts"]')).toHaveCount(0);

  await srcChip.click();

  // revealPath expands the folder: its child appears in the sidebar tree.
  await expect(
    page.locator('[data-fs-path$="src/index.ts"]').first(),
  ).toBeVisible({ timeout: 15_000 });
});
