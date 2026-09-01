/**
 * Embedded browser: the preview pane is now a real Chromium WebContentsView
 * attached to the window, positioned over the pane. Playwright drives the DOM
 * but cannot see native child views, so the native-side contract (a view
 * exists, tears down with the tab, survives a crash) is asserted through
 * `app.evaluate` against Electron's `webContents.getAllWebContents()`.
 */
import type { ElectronApplication } from "@playwright/test";
import { expect, MOD, test } from "./fixtures";

/**
 * Count the embedded-browser views: webContents that aren't backed by a
 * top-level BrowserWindow. (A WebContentsView's webContents reports getType()
 * === "window", so the only reliable discriminator is the window-id set.)
 */
async function browserViewCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ webContents, BrowserWindow }) => {
    const winIds = new Set(
      BrowserWindow.getAllWindows().map((w) => w.webContents.id),
    );
    return webContents.getAllWebContents().filter((wc) => !winIds.has(wc.id))
      .length;
  });
}

/** Visibility flags of the window's attached child views (embedded browsers). */
async function viewVisibility(app: ElectronApplication): Promise<boolean[]> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children =
      (win.contentView as unknown as { children?: Array<{ getVisible(): boolean }> })
        .children ?? [];
    return children.map((c) => c.getVisible());
  });
}

test("opens a web-preview tab with an address bar", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(
    page.getByRole("tab", { name: /preview/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const address = page
    .getByPlaceholder(/url|address|https?/i)
    .or(page.locator('input[type="url"]'))
    .or(page.getByRole("textbox"))
    .last();
  await expect(address).toBeVisible({ timeout: 8_000 });
  await address.click();
  await address.fill("http://localhost:5173");
  await expect(address).toHaveValue(/localhost:5173/);
});

test("creates a native browser view and tears it down with the tab", async ({
  app,
  page,
}) => {
  const before = await browserViewCount(app);

  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(
    page.getByRole("tab", { name: /preview/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const address = page.getByPlaceholder("http://localhost:3000");
  await address.click();
  await address.fill("about:blank");
  await address.press("Enter");

  // A native view must have been created for the tab.
  await expect
    .poll(() => browserViewCount(app), { timeout: 10_000 })
    .toBeGreaterThan(before);

  // Closing the tab tears the native view down again — and never crashes app.
  await page.keyboard.press(`${MOD}+w`);
  await expect
    .poll(() => browserViewCount(app), { timeout: 10_000 })
    .toBe(before);

  const alive = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed()),
  );
  expect(alive).toBe(true);
});

test("shows the view after navigation and hides it under an overlay", async ({
  app,
  page,
}) => {
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(
    page.getByRole("tab", { name: /preview/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const address = page.getByPlaceholder("http://localhost:3000");
  await address.click();
  await address.fill("data:text/html,<body style='background:red'>x</body>");
  await address.press("Enter");

  // After a real navigation the native view must actually be visible on screen.
  await expect
    .poll(() => viewVisibility(app), { timeout: 10_000 })
    .toEqual([true]);

  // A Radix overlay (command palette) must hide the view so it can't occlude it.
  await page.keyboard.press(`${MOD}+p`);
  await expect
    .poll(() => viewVisibility(app), { timeout: 5_000 })
    .toEqual([false]);

  // Closing the overlay shows the view again.
  await page.keyboard.press("Escape");
  await expect
    .poll(() => viewVisibility(app), { timeout: 5_000 })
    .toEqual([true]);
});

/** The URL of the embedded view (the non-window webContents), or "". */
async function viewUrl(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ webContents, BrowserWindow }) => {
    const winIds = new Set(
      BrowserWindow.getAllWindows().map((w) => w.webContents.id),
    );
    const view = webContents
      .getAllWebContents()
      .find((wc) => !winIds.has(wc.id));
    return view ? view.getURL() : "";
  });
}

test("URL settles after navigation and does not oscillate", async ({
  app,
  page,
}) => {
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(
    page.getByRole("tab", { name: /preview/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const address = page.getByPlaceholder("http://localhost:3000");

  const a = "data:text/html,<body>A</body>";
  const b = "data:text/html,<body>B</body>";

  // Navigate to A, then to B. The old feedback loop (tab.url ⇄ view) would
  // leapfrog and bounce the view back and forth between A and B forever.
  await address.click();
  await address.fill(a);
  await address.press("Enter");
  await expect.poll(() => viewUrl(app), { timeout: 10_000 }).toBe(a);

  await address.click();
  await address.fill(b);
  await address.press("Enter");
  await expect.poll(() => viewUrl(app), { timeout: 10_000 }).toBe(b);

  // It must STAY on B — sample twice over ~1s; no bounce back to A.
  const first = await viewUrl(app);
  await page.waitForTimeout(1000);
  const second = await viewUrl(app);
  expect(second).toBe(first);
  expect(second).toBe(b);
});

test("app survives an embedded-page renderer crash", async ({ app, page }) => {
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(
    page.getByRole("tab", { name: /preview/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const address = page.getByPlaceholder("http://localhost:3000");
  await address.click();
  await address.fill("about:blank");
  await address.press("Enter");
  await expect
    .poll(() => browserViewCount(app), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Force-crash the embedded page's renderer process.
  await app.evaluate(({ webContents, BrowserWindow }) => {
    const winIds = new Set(
      BrowserWindow.getAllWindows().map((w) => w.webContents.id),
    );
    const view = webContents
      .getAllWebContents()
      .find((wc) => !winIds.has(wc.id));
    view?.forcefullyCrashRenderer();
  });

  // The main app window is unaffected and still responsive.
  await expect(page.getByTestId("workspace")).toBeVisible();
  const alive = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed()),
  );
  expect(alive).toBe(true);
});

// --- AI interaction over CDP -----------------------------------------------

const AI_TAB = 7771;

/** Invoke the selected browser provider as its declared preview consumer. */
async function invoke(
  page: import("@playwright/test").Page,
  cmd: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    ([c, p]) =>
      window.__termco.capabilityCall({
        consumerPluginId: "preview-surface-native",
        capability: "browser.automation",
        method: "invoke",
        args: [c as string, p],
        caller: true,
      }),
    [cmd, payload] as const,
  );
}

/** Read a JS expression in the embedded view (the non-window webContents). */
async function evalInView(
  app: ElectronApplication,
  expression: string,
): Promise<unknown> {
  return app.evaluate(
    ({ webContents, BrowserWindow }, expr) => {
      const winIds = new Set(
        BrowserWindow.getAllWindows().map((w) => w.webContents.id),
      );
      const view = webContents
        .getAllWebContents()
        .find((wc) => !winIds.has(wc.id));
      return view ? view.executeJavaScript(expr as string) : null;
    },
    expression,
  );
}

test("AI clicks the exact ref-targeted element (CDP hit-test)", async ({
  app,
  page,
}) => {
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 20_000 });

  // A grid of same-shaped tiles; each records its own index when clicked. The
  // old center-of-box click hit neighbors; CDP hit-tests to the real target.
  const tiles = Array.from(
    { length: 9 },
    (_, i) =>
      `<a href="#" aria-label="tile ${i}" onclick="window.__hit=${i};return false" ` +
      `style="display:inline-block;width:120px;height:120px;margin:8px;background:#ddd">${i}</a>`,
  ).join("");
  // encodeURIComponent so quotes/specials don't terminate the data URL.
  const grid = `data:text/html,${encodeURIComponent(`<body style='margin:0'>${tiles}</body>`)}`;

  await invoke(page, "browser_create", {
    tabId: AI_TAB,
    url: grid,
    bounds: { x: 0, y: 80, width: 900, height: 600 },
  });
  await invoke(page, "browser_set_visible", { tabId: AI_TAB, visible: true });
  await page.waitForTimeout(1200);

  const snap = (await invoke(page, "browser_ai_snapshot", {
    tabId: AI_TAB,
  })) as { text?: string; error?: string };
  expect(snap.error).toBeUndefined();
  // Chromium-computed names disambiguate the tiles.
  expect(snap.text).toContain('"tile 5"');
  const ref = /"tile 5"\s*\[ref=(s\d+e\d+)\]/.exec(snap.text ?? "")?.[1];
  expect(ref).toBeTruthy();

  const clicked = (await invoke(page, "browser_ai_click", {
    tabId: AI_TAB,
    ref,
  })) as { ok?: boolean; error?: string };
  expect(clicked.error).toBeUndefined();
  // The RIGHT tile's handler fired — exactly tile 5, not a neighbor.
  await expect
    .poll(() => evalInView(app, "window.__hit"), { timeout: 5_000 })
    .toBe(5);

  await invoke(page, "browser_destroy", { tabId: AI_TAB });
});

test("AI refuses to click an occluded element instead of hitting the wrong one", async ({
  app,
  page,
}) => {
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 20_000 });

  // A tile fully covered by a fixed overlay. A blind center-click would land on
  // the overlay; the hit-test must reject it and never fire the tile's handler.
  const html =
    "<body style='margin:0'>" +
    "<a href='#' aria-label='target link' onclick='window.__hit=1' " +
    "style='display:block;width:200px;height:200px;background:#ccc'>x</a>" +
    "<div style='position:fixed;inset:0;background:rgba(0,0,0,.5)'></div>" +
    "</body>";
  const url = `data:text/html,${encodeURIComponent(html)}`;

  await invoke(page, "browser_create", {
    tabId: AI_TAB,
    url,
    bounds: { x: 0, y: 80, width: 900, height: 600 },
  });
  await invoke(page, "browser_set_visible", { tabId: AI_TAB, visible: true });
  await page.waitForTimeout(1000);

  const snap = (await invoke(page, "browser_ai_snapshot", {
    tabId: AI_TAB,
  })) as { text?: string };
  const ref = /\[ref=(s\d+e\d+)\]/.exec(snap.text ?? "")?.[1];
  expect(ref).toBeTruthy();

  const clicked = (await invoke(page, "browser_ai_click", {
    tabId: AI_TAB,
    ref,
  })) as { ok?: boolean; error?: string };
  // Occluded → explicit error, and the tile's handler never fired.
  expect(clicked.error).toMatch(/off-screen|covered/i);
  expect(await evalInView(app, "window.__hit || 0")).toBe(0);

  await invoke(page, "browser_destroy", { tabId: AI_TAB });
});

test("AI can observe console/network, evaluate JS, and select/wait", async ({
  page,
}) => {
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 20_000 });

  const html =
    "<body>" +
    "<select aria-label='pick'><option value='a'>Apple</option><option value='b'>Banana</option></select>" +
    "<img src='http://127.0.0.1:1/x.png'>" +
    "<div id='m'></div>" +
    "<script>console.log('log-marker-1');console.error('err-marker-2');" +
    "setTimeout(()=>{document.getElementById('m').textContent='LATE_TEXT'},250)</script>" +
    "</body>";
  await invoke(page, "browser_create", {
    tabId: AI_TAB,
    url: `data:text/html,${encodeURIComponent(html)}`,
    bounds: { x: 0, y: 80, width: 900, height: 600 },
  });
  await invoke(page, "browser_set_visible", { tabId: AI_TAB, visible: true });
  await page.waitForTimeout(1000);

  // Console: log + error captured.
  const con = (await invoke(page, "browser_ai_console", { tabId: AI_TAB })) as {
    entries: Array<{ level: string; text: string }>;
  };
  expect(con.entries.some((e) => e.text.includes("log-marker-1"))).toBe(true);
  expect(
    con.entries.some((e) => e.level === "error" && e.text.includes("err-marker-2")),
  ).toBe(true);

  // Network tool responds (structured request capture is exercised manually /
  // on real sites; data:-document subresource events are environment-flaky).
  const net = (await invoke(page, "browser_ai_network", {
    tabId: AI_TAB,
  })) as { entries: unknown[] };
  expect(Array.isArray(net.entries)).toBe(true);

  // Evaluate.
  const ev = (await invoke(page, "browser_ai_evaluate", {
    tabId: AI_TAB,
    expression: "6*7",
  })) as { ok?: boolean; result?: string };
  expect(ev.result).toBe("42");

  // wait_for text that appears late.
  const wf = (await invoke(page, "browser_ai_wait_for", {
    tabId: AI_TAB,
    text: "LATE_TEXT",
    timeoutMs: 3000,
  })) as { ok?: boolean; waited?: boolean };
  expect(wf.waited).toBe(true);

  // select_option by visible text.
  const snap = (await invoke(page, "browser_ai_snapshot", {
    tabId: AI_TAB,
  })) as { text?: string };
  const selRef = /"pick"\s*\[ref=(s\d+e\d+)\]/.exec(snap.text ?? "")?.[1];
  const sel = (await invoke(page, "browser_ai_select", {
    tabId: AI_TAB,
    ref: selRef,
    values: ["Banana"],
  })) as { ok?: boolean; selected?: string[] };
  expect(sel.selected).toEqual(["b"]);

  await invoke(page, "browser_destroy", { tabId: AI_TAB });
});

test("AI types into a password field (gated by approval, not refused)", async ({
  app,
  page,
}) => {
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 20_000 });

  const html =
    "<body><form>" +
    "<input aria-label='user' type='text'>" +
    "<input aria-label='pass' type='password'>" +
    "</form></body>";
  await invoke(page, "browser_create", {
    tabId: AI_TAB,
    url: `data:text/html,${encodeURIComponent(html)}`,
    bounds: { x: 0, y: 80, width: 900, height: 600 },
  });
  await invoke(page, "browser_set_visible", { tabId: AI_TAB, visible: true });
  await page.waitForTimeout(1000);

  const snap = (await invoke(page, "browser_ai_snapshot", {
    tabId: AI_TAB,
  })) as { text?: string };
  const userRef = /"user"\s*\[ref=(s\d+e\d+)\]/.exec(snap.text ?? "")?.[1];
  const passRef = /"pass"\s*\[ref=(s\d+e\d+)\]/.exec(snap.text ?? "")?.[1];

  // Field-info drives the approval gate: password field is flagged, text isn't.
  expect(await invoke(page, "browser_ai_field_info", { tabId: AI_TAB, ref: userRef })).toEqual({
    isPassword: false,
  });
  expect(await invoke(page, "browser_ai_field_info", { tabId: AI_TAB, ref: passRef })).toEqual({
    isPassword: true,
  });

  // Typing into the password field now succeeds (no hard refusal).
  const typed = (await invoke(page, "browser_ai_type", {
    tabId: AI_TAB,
    ref: passRef,
    text: "admin",
  })) as { ok?: boolean; error?: string };
  expect(typed.error).toBeUndefined();
  expect(await evalInView(app, "document.querySelector('input[type=password]').value")).toBe(
    "admin",
  );

  await invoke(page, "browser_destroy", { tabId: AI_TAB });
});
