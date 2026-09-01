/**
 * Ports sidebar view: the ←→ rail icon opens the port-forwarding panel; in a
 * local (non-ssh) rig it shows the SSH-only explainer instead of the form.
 */
import { expect, test } from "./fixtures";

test("ports rail icon opens the panel with the ssh gate", async ({ page }) => {
  await page.getByLabel("Ports", { exact: true }).click();
  await expect(page.getByText("PORTS", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByText("Only available in SSH rigs"),
  ).toBeVisible({ timeout: 10_000 });
});
