import { expect, MOD, configuredAiTest as test } from "./fixtures";
import type { ElectronApplication, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

test.use({ layeredRenderer: true });

test("split headers and terminals stay opaque around a live browser", async ({ app, page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.keyboard.press(`${MOD}+Shift+o`);
  const address = page.getByPlaceholder("http://localhost:3000");
  await address.fill("data:text/html,<title>Paint Regression</title><body style='background:crimson'>Live browser</body>");
  await address.press("Enter");
  const browserTab = page.getByRole("tab", { name: /Paint Regression/ });
  await expect(browserTab).toBeVisible();
  await page.getByRole("tab").first().click();
  await browserTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the Side", exact: true }).click();
  await expect(page.locator('[data-live-browser-hole="true"]:visible')).toHaveCount(1);
  const expectOpaqueWorkspace = async (stage: string) => {
    const points = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const browserHeader = rect('[id="ws-right"] [data-pane-drag-handle]');
      const terminal = rect('[id="ws-left"] [data-terminal-padding]');
      const hole = rect('[data-live-browser-hole="true"]');
      return {
        width: innerWidth,
        samples: [
          { name: "browser pane title background", x: browserHeader.right - 30, y: browserHeader.top + browserHeader.height / 2, expected: 255 },
          { name: "terminal pane background", x: terminal.left + terminal.width / 2, y: terminal.top + terminal.height / 2, expected: 255 },
          { name: "live browser hole", x: hole.left + hole.width / 2, y: hole.top + hole.height / 2, expected: 0 },
        ],
      };
    });
    const png = await page.screenshot({ omitBackground: true, path: testInfo.outputPath(`workspace-alpha-${stage}.png`) });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / points.width;
    const alpha = points.samples.map(point => ({
      name: point.name,
      alpha: data[(Math.floor(point.y * scale) * info.width + Math.floor(point.x * scale)) * 4 + 3],
    }));
    expect(alpha).toEqual(points.samples.map(point => ({ name: point.name, alpha: point.expected })));
  };
  await expectOpaqueWorkspace("initial");
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const handle = page.getByRole("separator", { name: "Resize AI panel" });
  for (let cycle = 0; cycle < 4; cycle++) {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, box.y + box.height / 2, { steps: 20 });
    await page.mouse.up();
    await handle.focus();
    await page.keyboard.press("Home");
  }
  await page.getByRole("button", { name: "Float", exact: true }).click();
  const mini = page.locator("[data-ai-mini-window]");
  await expect(mini).toBeVisible();
  for (const x of [10, 500, 200]) {
    const title = (await mini.locator(".cursor-grab").boundingBox())!;
    await page.mouse.move(title.x + title.width / 2, title.y + 4);
    await page.mouse.down();
    await page.mouse.move(x, 180, { steps: 15 });
    await page.mouse.up();
  }
  await mini.getByRole("button", { name: "Close", exact: true }).click();
  await expect(mini).toHaveCount(0);
  await expectOpaqueWorkspace("after-chat-moves");
  await captureNative(app, testInfo.outputPath("opaque-workspace-native.png"));
});

async function captureNative(app: ElectronApplication, path: string) {
  if (process.env.TERMCO_E2E_NATIVE_CAPTURE !== "1") return;
  let png = "";
  // ScreenCaptureKit can briefly return an empty thumbnail after a resize.
  // Never silently accept that as evidence of a correctly composited window.
  await expect.poll(async () => {
    png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.showInactive();
      const sourceId = win.getMediaSourceId();
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 2200, height: 1440 } });
      const source = sources.find(source => source.id === sourceId);
      return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
    });
    return png.length;
  }, { timeout: 10_000, message: "Native window capture must contain pixels" }).toBeGreaterThan(0);
  writeFileSync(path, Buffer.from(png, "base64"));
}

test("rendered Markdown stays in its pane while the chat expands over a split workspace", async ({ app, page }, testInfo) => {
  if (process.env.TERMCO_E2E_NATIVE_CAPTURE === "1") await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.getByRole("button", { name: "README.md", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Termco E2E", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /README.md/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open Terminal Below", exact: true }).click();
  const markdownPane = page.locator('[id="ws-left"]');
  const terminalPane = page.locator('[id="ws-right"]');
  await expect(terminalPane.locator("[data-terminal-padding]:visible")).toContainText("%", { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("markdown-split.png") });
  await expect.soft(page.getByRole("button", { name: "Raw", exact: true })).toHaveCount(1, { timeout: 2000 });
  const heading = page.getByRole("heading", { name: "Termco E2E", exact: true });
  const headingBox = (await heading.first().boundingBox())!;
  const paneBox = (await markdownPane.boundingBox())!;
  expect.soft(headingBox.y).toBeGreaterThan(paneBox.y + 28);
  expect.soft(headingBox.y + headingBox.height).toBeLessThan(paneBox.y + paneBox.height);

  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const panel = page.locator('[data-onboarding-target="ai-chat.panel"]');
  const handle = page.getByRole("separator", { name: "Resize AI panel" });
  await expect(panel).toBeVisible();
  await panel.getByPlaceholder("Describe the outcome you want…").fill("A draft that must appear exactly once");
  for (let cycle = 0; cycle < 3; cycle++) {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, box.y + box.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.screenshot({ path: testInfo.outputPath(`chat-expanded-${cycle}.png`) });
    if (cycle === 2) await captureNative(app, testInfo.outputPath("chat-expanded-native.png"));
    await expect.soft(panel).toHaveCount(1, { timeout: 2000 });
    const uncovered = await panel.first().evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [0.1, 0.4, 0.7, 0.9].flatMap(x => [0.1, 0.5, 0.9].flatMap(y => {
        const top = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
        return top && el.contains(top) ? [] : [{ x, y, top: top?.outerHTML.slice(0, 200) }];
      }));
    });
    expect.soft(uncovered).toEqual([]);
    await handle.focus();
    await page.keyboard.press("Home");
    await page.getByRole("tab", { name: /README.md/ }).click();
    await page.getByRole("button", { name: "Arrange tabs", exact: true }).click();
    await page.getByRole("button", { name: cycle % 2 ? "Place tab below" : "Place tab right", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`rearranged-${cycle}.png`) });
    await expect.soft(page.getByRole("button", { name: "Raw", exact: true })).toHaveCount(1, { timeout: 2000 });
  }
});

async function openBrowserSplit(page: Page) {
  await page.getByRole("button", { name: "README.md", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Termco E2E", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /README.md/ }).dblclick();
  await page.keyboard.press(`${MOD}+Shift+o`);
  const address = page.getByPlaceholder("http://localhost:3000");
  await address.fill("data:text/html,<title>Composition Browser</title><body style='background:crimson;color:white' onclick='this.dataset.clicks = String(Number(this.dataset.clicks || 0) + 1)'>Browser content must stay in its pane</body>");
  await address.press("Enter");
  const browserTab = page.getByRole("tab", { name: /Composition Browser/ });
  await expect(browserTab).toBeVisible();
  await page.getByRole("tab", { name: /README.md/ }).click();
  await browserTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open Below", exact: true }).click();
  await expect(page.getByRole("button", { name: "Raw", exact: true })).toHaveCount(1);
}

test("a native browser cannot cover the expanded chat", async ({ app, page }, testInfo) => {
  await openBrowserSplit(page);
  const nativeViews = () => app.evaluate(({ BrowserWindow, WebContentsView }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.map(v => ({ visible: v.getVisible(), bounds: v.getBounds(), renderer: v instanceof WebContentsView && v.webContents.getURL().includes("liveBrowserLayer=1") })));
  await expect.poll(async () => (await nativeViews()).some(v => v.visible)).toBe(true);
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const panel = page.locator('[data-onboarding-target="ai-chat.panel"]');
  const handle = page.getByRole("separator", { name: "Resize AI panel" });
  await handle.focus();
  await page.keyboard.press("End");
  await page.screenshot({ path: testInfo.outputPath("chat-over-native-browser.png") });
  await captureNative(app, testInfo.outputPath("chat-over-native-browser-composited.png"));
  await expect.poll(async () => {
    const chat = (await panel.boundingBox())!;
    const views = await nativeViews();
    const rendererIndex = views.findIndex(v => v.renderer);
    return views.filter((v, index) => index > rendererIndex && v.visible && v.bounds.x < chat.x + chat.width
      && v.bounds.x + v.bounds.width > chat.x && v.bounds.y < chat.y + chat.height
      && v.bounds.y + v.bounds.height > chat.y);
  }, { timeout: 3000 }).toEqual([]);
  // A partial expansion must still let the exposed browser receive input
  // through the transparent renderer above it.
  await handle.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  const hole = (await page.locator('[data-live-browser-hole="true"]:visible').boundingBox())!;
  expect((await panel.boundingBox())!.x).toBeGreaterThan(hole.x + 24);
  await page.mouse.click(hole.x + 24, hole.y + 40);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v =>
      v instanceof WebContentsView && v.webContents.getURL().startsWith("data:text/html"));
    return view instanceof WebContentsView ? view.webContents.executeJavaScript("document.body.dataset.clicks") : null;
  })).toBe("1");
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect.poll(async () => (await nativeViews()).at(-1)?.renderer).toBe(false);
});

test("native browser bounds follow repeated moves without a size change", async ({ app, page }, testInfo) => {
  await openBrowserSplit(page);
  for (const position of ["above", "below", "right", "left", "above"]) {
    await page.getByRole("button", { name: "Arrange tabs", exact: true }).click();
    await page.getByRole("button", { name: `Place tab ${position}`, exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`browser-${position}.png`) });
    await expect.poll(async () => {
      const hole = (await page.locator('[data-live-browser-hole="true"]:visible').boundingBox())!;
      const bounds = await app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v =>
          v instanceof WebContentsView && v.webContents.getURL().startsWith("data:text/html"));
        return view?.getBounds();
      });
      return bounds && Math.abs(bounds.x - hole.x) <= 1 && Math.abs(bounds.y - hole.y) <= 1
        && Math.abs(bounds.width - hole.width) <= 1 && Math.abs(bounds.height - hole.height) <= 1
        ? null : { native: bounds, dom: hole };
    }, { timeout: 2000 }).toBe(null);
  }
  const pane = page.locator('[id="ws-right"]');
  const title = (await pane.locator("[data-pane-drag-handle]").boundingBox())!;
  const area = (await page.locator("[data-workspace-surface]").boundingBox())!;
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height - 12, { steps: 15 });
  await expect(page.getByTestId("pane-dock-drop-indicator")).toBeVisible();
  await expect.poll(() => app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const top = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
    return top instanceof WebContentsView && top.webContents.getURL().includes("liveBrowserLayer=1");
  })).toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("pane-dock-drop-indicator")).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const top = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
    return top instanceof WebContentsView && top.webContents.getURL().startsWith("data:text/html");
  })).toBe(true);
});

test("a retained browser and updating chat survive repeated full-width dragging", async ({ app, page }, testInfo) => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1726, 1000);
    if (process.env.TERMCO_E2E_NATIVE_CAPTURE === "1") BrowserWindow.getAllWindows()[0].showInactive();
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await openBrowserSplit(page);
  await page.getByRole("button", { name: "Close bottom pane", exact: true }).click();
  // Keep the browser tab warm, then visit several terminals as in the report.
  await page.getByRole("tab").first().click();
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${MOD}+t`);
  await expect(page.locator('[data-live-browser-hole="true"]')).toHaveCount(0, { timeout: 2000 });
  expect(await page.locator(".termco-app").first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const panel = page.locator('[data-onboarding-target="ai-chat.panel"]');
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    const seed = window.__termcoE2E.aiSeedMessages as (messages: unknown[]) => boolean;
    let count = 0;
    const update = () => seed([
      { id: "stress-user", role: "user", parts: [{ type: "text", text: "Keep updating this conversation while I arrange the workspace." }] },
      { id: "stress-assistant", role: "assistant", parts: [{ type: "text", text:
        "## Resize regression\n\n" + Array.from({ length: 35 }, (_, i) => `- Item ${i}: a visible result that must only be painted once.`).join("\n") + `\n\nUpdate ${count++}` }] },
    ]);
    update();
    const timer = setInterval(update, 80);
    window.__termcoE2E.stopResizeStress = () => clearInterval(timer);
  });
  const handle = page.getByRole("separator", { name: "Resize AI panel" });
  try {
    for (let cycle = 0; cycle < 12; cycle++) {
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(cycle % 2 ? 1340 : 44, box.y + box.height / 2, { steps: 25 });
      await page.mouse.up();
      await expect(panel).toHaveCount(1);
      if (cycle === 10 || cycle === 11) {
        await page.screenshot({ path: testInfo.outputPath(`stress-${cycle}.png`) });
        if (cycle === 10) await captureNative(app, testInfo.outputPath("stress-native.png"));
      }
    }
    await expect(page.getByRole("heading", { name: "Resize regression", exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Termco E2E", exact: true })).toHaveCount(0);
  } finally {
    await page.evaluate(() => (window.__termcoE2E.stopResizeStress as () => void)());
  }
});
