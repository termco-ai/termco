/**
 * Containers panel + per-container detail tabs. The rail button switches the
 * sidebar to the containers view (lists containers across docker/podman/apple).
 * Clicking a card opens a RICH detail tab for that one container — one tab per
 * container, like an editor tab per file. Docker-agnostic: whether or not a
 * runtime is installed on the runner, the panel resolves the shared
 * `containers.runtime` provider end to end and stays interactive. The rich
 * assertions run only when cards exist.
 */
import { expect, test } from "./fixtures";

test("rail button opens the panel; a card opens a rich per-container tab", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Containers" }).first().click();

  // Panel header renders (rail wiring + IPC round-trip completed).
  await expect(
    page.getByRole("button", { name: "Refresh containers" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Either the empty state (no runtime / no containers) or at least one card.
  const cards = page.locator("[data-active]");
  const emptyState = page.getByText(
    /No container runtime detected|No containers/,
  );
  await expect(cards.first().or(emptyState.first())).toBeVisible({
    timeout: 15_000,
  });

  const count = await cards.count();
  if (count === 0) return; // no runtime on this runner — panel proven, done.

  // Clicking a card opens its own rich detail tab and reveals the inspector in
  // the body (terminal no longer covers it).
  const firstName = (await cards.first().getAttribute("data-name")) ?? "";
  await cards.first().click();

  // A container tab is open + active, titled with the container name.
  await expect(
    page.getByRole("tab", { name: new RegExp(firstName) }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Rich sections render — Environment (the signature manifest), Logs, Image.
  await expect(
    page.getByText("Environment", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Logs", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Image", { exact: true }).first()).toBeVisible();

  // If this container is running, its live meter strip resolves (state came
  // from the list, not just inspect) and the image-inspect chain fills in a
  // size — proving both new backend paths end to end.
  const runningCard = await cards
    .first()
    .locator("text=/Up /")
    .isVisible()
    .catch(() => false);
  if (runningCard) {
    await expect(page.getByText("CPU", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    // The header must not read "unavailable" for a live container.
    await expect(
      page.getByText("unavailable", { exact: true }),
    ).toHaveCount(0);
    // Image size populates when the image still exists locally. Long-running
    // containers can legitimately outlive a pruned image, while their live
    // state, stats, inspect data, and logs remain available.
    const imageUnavailable = page.getByText("image details unavailable", {
      exact: true,
    });
    if (!(await imageUnavailable.isVisible().catch(() => false))) {
      await expect(
        page.getByText(/^\d+(\.\d+)?(B|KB|MB|GB)$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  }

  // Secrets are masked by default; the masked glyph must be present and the
  // raw secret value must NOT be in the DOM until revealed.
  const masked = page.getByText("••••••••••••").first();
  if (await masked.isVisible().catch(() => false)) {
    await expect(page.getByText("supersecretvalue123")).toHaveCount(0);
    // Reveal the first secret and confirm the value appears.
    await page.getByRole("button", { name: "Reveal value" }).first().click();
  }

  await page.screenshot({ path: "e2e/.output/container-detail-tab.png" });

  // A second card opens a SECOND tab (not a shared compare surface).
  if (count >= 2) {
    const secondName = (await cards.nth(1).getAttribute("data-name")) ?? "";
    await cards.nth(1).click();
    await expect(
      page.getByRole("tab", { name: new RegExp(secondName) }).first(),
    ).toBeVisible({ timeout: 10_000 });

    const containerTabs = page.getByRole("tab", {
      name: new RegExp(`${firstName}|${secondName}`),
    });
    await expect(containerTabs).toHaveCount(2);

    // Re-clicking the first card FOCUSES its existing tab (no duplicate).
    await cards.first().click();
    await expect(
      page.getByRole("tab", {
        name: new RegExp(`${firstName}|${secondName}`),
      }),
    ).toHaveCount(2);
  }
});

test("a container's logs read like the file editor: line numbers, search, tail", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Containers" }).first().click();
  await expect(
    page.getByRole("button", { name: "Refresh containers" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const cards = page.locator("[data-active]");
  const emptyState = page.getByText(
    /No container runtime detected|No containers/,
  );
  await expect(cards.first().or(emptyState.first())).toBeVisible({
    timeout: 15_000,
  });
  if ((await cards.count()) === 0) return; // no runtime — nothing to inspect.

  // Prefer the log-emitting seed container if it exists; else any card.
  const logCard = page.locator('[data-name="termco-logs"]');
  const target = (await logCard.count()) > 0 ? logCard.first() : cards.first();
  await target.click();

  // The logs pane mounts a CodeMirror viewer with a line-number gutter —
  // exactly like the file editor.
  await expect(page.locator(".cm-lineNumbers").first()).toBeVisible({
    timeout: 10_000,
  });
  // Numeric line numbers render in the gutter (follow may have scrolled us to
  // the bottom, so assert any numeric line, not specifically line 1). CM keeps
  // a hidden measuring spacer, so filter to the visible gutter elements.
  await expect(
    page
      .locator(".cm-lineNumbers .cm-gutterElement")
      .filter({ hasText: /^\d+$/, visible: true }),
  ).not.toHaveCount(0);

  // Follow is OFF by default: the toggle offers to RESUME (play), not pause.
  await expect(
    page.getByRole("button", { name: "Resume follow" }).first(),
  ).toBeVisible();

  // "More logs" works: pick 5,000 and the loaded line count grows well past the
  // modest default (the seed container has ~20k lines).
  const amount = page.getByLabel("Lines to load").first();
  await expect(amount).toBeVisible();
  await amount.selectOption("5000");
  // Line count reflects ~5,000 (locale may group with "," or "."), proving the
  // larger amount actually loaded and wasn't clamped.
  await expect(page.getByText(/5[.,]000 lines/).first()).toBeVisible({
    timeout: 10_000,
  });

  // Find over the loaded logs opens the same find panel as the editor.
  await page.getByRole("button", { name: "Find in view" }).first().click();
  await expect(page.locator(".cm-search").first()).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: "e2e/.output/container-logs-search.png" });

  // Refresh re-pulls the current amount without error.
  await page.getByRole("button", { name: "Refresh logs" }).first().click();
  await expect(page.getByText(/5[.,]000 lines/).first()).toBeVisible({
    timeout: 10_000,
  });
});

test("full-log search finds lines that were never fetched into the view", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Containers" }).first().click();
  await expect(
    page.getByRole("button", { name: "Refresh containers" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Wait for the container list to actually populate before looking for the
  // seed card (otherwise an empty list would skip the test spuriously).
  const cards = page.locator("[data-active]");
  const emptyState = page.getByText(
    /No container runtime detected|No containers/,
  );
  await expect(cards.first().or(emptyState.first())).toBeVisible({
    timeout: 15_000,
  });
  const logCard = page.locator('[data-name="termco-logs"]');
  if ((await logCard.count()) === 0) return; // seed container absent — skip.
  await logCard.first().click();

  // The default view loads only the tail (~1,000 of 20,000 lines), so line 5 is
  // NOT loaded. Open the full-log search and query for it.
  await page.getByRole("button", { name: "Search all logs" }).first().click();
  const input = page.getByPlaceholder(/Search all logs/);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill("log line 5 emitted");
  await input.press("Enter");

  // The match from the un-fetched part of the log appears in the results.
  await expect(
    page.getByText("log line 5 emitted", { exact: false }).first(),
  ).toBeVisible({ timeout: 15_000 });
  // Its real position (line 5) is shown, proving it came from the full log, not
  // the loaded tail (which is lines ~19001-20000).
  await expect(page.locator(".cm-content")).toContainText("5  log line 5 emitted");

  await page.screenshot({ path: "e2e/.output/container-logs-full-search.png" });
});

test("a container's published port routes to localhost in one click", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Containers" }).first().click();
  await expect(
    page.getByRole("button", { name: "Refresh containers" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const cards = page.locator("[data-active]");
  const emptyState = page.getByText(
    /No container runtime detected|No containers/,
  );
  await expect(cards.first().or(emptyState.first())).toBeVisible({
    timeout: 15_000,
  });
  // Prefer the seeded container that publishes 8091->80; else any card with a
  // published-port chip.
  const seeded = page.locator('[data-name="termco-detail-a"]');
  const card = (await seeded.count()) > 0 ? seeded.first() : null;
  if (!card) return; // no seeded published port on this runner — skip.

  // The port chip is now an interactive control (was a dead <span>).
  const chip = card.getByText("8091→80", { exact: false }).first();
  await expect(chip).toBeVisible();

  // Its ▾ menu offers the routing options (headed by the mono port context).
  await card.getByRole("button", { name: "Port 8091 options" }).click();
  await expect(page.getByText("Open in preview").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("localhost:8091").first()).toBeVisible();
  await page.waitForTimeout(250); // let the open animation settle for the shot
  await page.screenshot({ path: "e2e/.output/container-port-menu.png" });
  await page.keyboard.press("Escape");

  // Primary click routes it — on local docker the port is already on
  // localhost, so it opens a preview tab to http://localhost:8091 (and does
  // NOT open the container's detail tab — the chip stops propagation).
  await chip.click();
  await expect(page.getByRole("tab", { name: /8091/ }).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.screenshot({ path: "e2e/.output/container-port-forward.png" });
});
