/**
 * Rig-switch performance: switching rigs while an Agent run/session view is
 * open must NOT freeze the app or show a global loading indicator. Each view
 * loads its own data locally; the app frame stays responsive.
 */
import { expect, test } from "./fixtures";
import { openAiPanel } from "./helpers";

type E2E = {
  rigCreateLocal: (name: string, root: string) => string;
  rigCreateSsh: (connectionId: string, root: string) => string;
  rigSetActive: (id: string) => void;
  debugSeedRun: (opts: { runId: string; rigId: string; title: string }) => void;
};

function e2e(page: import("@playwright/test").Page) {
  return {
    createRig: (name: string, root: string) =>
      page.evaluate(
        ([n, r]) =>
          (window as unknown as { __termcoE2E: E2E }).__termcoE2E.rigCreateLocal(n, r),
        [name, root] as const,
      ),
    setActive: (id: string) =>
      page.evaluate(
        (i) => (window as unknown as { __termcoE2E: E2E }).__termcoE2E.rigSetActive(i),
        id,
      ),
    seedRun: (runId: string, rigId: string, title: string) =>
      page.evaluate(
        ([a, b, c]) =>
          (window as unknown as { __termcoE2E: E2E }).__termcoE2E.debugSeedRun({
            runId: a,
            rigId: b,
            title: c,
          }),
        [runId, rigId, title] as const,
      ),
  };
}

async function openAgentsTab(page: import("@playwright/test").Page) {
  await openAiPanel(page);
  await page.getByRole("button", { name: "agents", exact: true }).click();
}

test("switching rigs with an open run detail stays responsive — no global loading", async ({
  page,
}) => {
  const api = e2e(page);

  // Two rigs; a run belongs to rig A. Open its detail.
  const rigA = await api.createRig("rig-A", "/a");
  const rigB = await api.createRig("rig-B", "/b");
  await api.setActive(rigA);
  await api.seedRun("run-A", rigA, "Runs on A");

  await openAgentsTab(page);
  await page.getByText("Runs on A").click();
  // The detail view is open (transcript composer present).
  await expect(page.getByPlaceholder("Send a follow-up…")).toBeVisible({ timeout: 10_000 });

  // Switch to rig B WHILE the detail is open, and time how long the main thread
  // is blocked (a global freeze would make this evaluate slow to schedule).
  const t0 = Date.now();
  await api.setActive(rigB);
  // Immediately probe responsiveness: a trivial evaluate must return fast if the
  // main thread isn't wedged.
  await page.evaluate(() => document.title);
  const blockedMs = Date.now() - t0;

  // The app must NOT show a global full-screen loading overlay.
  await expect(page.getByTestId("app-loading")).toHaveCount(0);

  // The switch is snappy (generous ceiling; a whole-app freeze would blow past).
  expect(blockedMs).toBeLessThan(1500);

  // The A run isn't lost — it's clearly under "Other rigs" now (not the open
  // detail): the panel followed the switch, the run stays reachable.
  await expect(page.getByText(/Other rigs · 1/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByPlaceholder("Send a follow-up…")).toHaveCount(0);
});

test("switching to a SLOW ssh rig keeps the app responsive (localized loading only)", async ({
  page,
}) => {
  const api = e2e(page);
  const local = await api.createRig("local", "/l");
  await api.setActive(local);
  await openAgentsTab(page);

  // A non-routable host makes shared SSH home resolution + session listing hang
  // timeout). Switching to it must NOT freeze the app or show a global loader.
  const ssh = await page.evaluate(
    () =>
      (window as unknown as { __termcoE2E: E2E }).__termcoE2E.rigCreateSsh(
        "10.255.255.1",
        "/root",
      ),
    // rigCreateSsh already sets it active — this IS the switch.
  );
  expect(ssh).toBeTruthy();

  // While the ssh resolve is still hanging, the app frame must stay interactive:
  // a trivial evaluate returns instantly, and no global loader is shown.
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.evaluate(() => document.title);
  expect(Date.now() - t0).toBeLessThan(500);
  await expect(page.getByTestId("app-loading")).toHaveCount(0);

  // The agents panel shows its OWN localized loading (not a frozen app), and
  // the dock mode tabs are still clickable.
  await expect(page.getByText(/Loading history…/)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
});
