/**
 * Playwright + Electron fixtures. Each test gets a freshly-launched Electron app
 * pointed at a seeded temp workspace (files + a git repo with a pending change),
 * with app state (store/secrets/window-state) isolated into a throwaway dir.
 */
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type E2EReplacementRequest = {
  pluginId: string;
  replacementId: string;
  name?: string;
  target?: "main-provider" | "renderer-provider" | "server" | "renderer-ui";
};

declare global {
  interface Window {
    __termcoE2E: Record<string, unknown> & {
      /** Test-harness adapter over the production plan → draft → apply
       * contract. This intentionally does not restore the removed legacy
       * mutation signature on `window.__termco`. */
      copyAndReplacePluginThroughPlan(
        request: E2EReplacementRequest,
      ): Promise<unknown>;
    };
  }
}

export const MAIN = fileURLToPath(
  new URL("../dist-electron/main/index.cjs", import.meta.url),
);

export interface Workspace {
  dir: string;
  userData: string;
}

/** Seed a workspace with a few files and a git repo (one commit + a dirty file). */
export function seedWorkspace(): Workspace {
  const dir = mkdtempSync(join(tmpdir(), "termco-e2e-ws-"));
  const userData = mkdtempSync(join(tmpdir(), "termco-e2e-ud-"));
  writeFileSync(join(dir, "README.md"), "# Termco E2E\n\nHello world from the workspace.\n");
  writeFileSync(join(dir, "notes.txt"), "line one\nline two\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export const answer = 42;\n");

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "ignore",
    });
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "e2e@termco.dev");
    git("config", "user.name", "Termco E2E");
    git("add", "-A");
    git("commit", "-q", "-m", "initial commit");
    // Leave one uncommitted change so the source-control panel has content.
    writeFileSync(join(dir, "notes.txt"), "line one\nline two\nline three (uncommitted)\n");
  } catch {
    // git missing — non-git specs still run
  }
  // Every run gets a placeholder provider key. Without one the app renders its
  // keyless state and the AI dock never mounts — which used to be masked by the
  // developer's REAL macOS keychain entry, so the suite passed here and would
  // have failed on any clean machine. `liveTest` overwrites it with a real key.
  writeSecrets(userData, "sk-e2e-placeholder-not-a-real-key");
  return { dir, userData };
}

function writeSecrets(userData: string, key: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, "secrets.json"),
    JSON.stringify({ "termco-ai::openai-api-key": key }),
    { mode: 0o600 },
  );
}

/** Merge a provider key into the workspace's isolated secrets file. */
function mergeSecret(userData: string, account: string, key: string): void {
  const path = join(userData, "secrets.json");
  let existing: Record<string, string> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    // no secrets file yet
  }
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...existing, [`termco-ai::${account}`]: key }),
    { mode: 0o600 },
  );
}

/** Read a named key from `.env.e2e` (gitignored), falling back to the env. */
function envE2eKey(name: string): string | null {
  const envFile = fileURLToPath(new URL("../.env.e2e", import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch {
    return process.env[name]?.trim() || null;
  }
  const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m").exec(raw);
  const key = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  return key || process.env[name]?.trim() || null;
}

/** Anthropic key for live specs — same contract as `liveOpenAiKey`. */
export function liveAnthropicKey(): string | null {
  return envE2eKey("ANTHROPIC_API_KEY");
}

export type CustomEndpointSeed = {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  contextLimit?: number;
};

/**
 * Seed a custom OpenAI-compatible endpoint into the throwaway settings store
 * and select its `compat-<id>` model as the default — lets live specs run
 * against a LOCAL model (no API key, no cost). The settings file must exist
 * before launch; the renderer reads it when the preferences store loads.
 */
export function seedCustomEndpoint(
  workspace: Workspace,
  endpoint: CustomEndpointSeed,
): void {
  mkdirSync(workspace.userData, { recursive: true });
  writeFileSync(
    join(workspace.userData, "termco-settings.json"),
    JSON.stringify({
      customEndpoints: [endpoint],
      defaultModelId: `compat-${endpoint.id}`,
    }),
  );
}

/** Seed the Anthropic key into the isolated secrets file (keychain untouched). */
export function seedAnthropicKey(workspace: Workspace, key: string): void {
  mergeSecret(workspace.userData, "anthropic-api-key", key);
}

/**
 * Live-model E2E: an OpenAI key from `.env.e2e` (gitignored), seeded into the
 * throwaway userData rather than the OS keychain.
 *
 * `TERMCO_E2E=1` switches the secrets backend to that file store on every
 * platform, so a test run cannot read, overwrite or delete the developer's own
 * key — the keychain entry is machine-global and shares service+account with
 * the real app.
 *
 * Specs that need it call `requireLiveKey()` and skip when it is absent, so the
 * normal suite still runs offline and free.
 */
export function liveOpenAiKey(): string | null {
  const envFile = fileURLToPath(new URL("../.env.e2e", import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch {
    return process.env.OPENAI_API_KEY?.trim() || null;
  }
  const m = /^\s*OPENAI_API_KEY\s*=\s*(.+)$/m.exec(raw);
  const key = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  return key || null;
}

/** Write the key into a workspace's isolated secrets file, keychain untouched. */
export function seedOpenAiKey(workspace: Workspace, key: string): void {
  writeSecrets(workspace.userData, key);
}

export const test = base.extend<{
  workspace: Workspace;
  app: ElectronApplication;
  page: Page;
}>({
  workspace: async ({}, use) => {
    await use(seedWorkspace());
  },

  app: async ({ workspace }, use) => {
    const launch = () =>
      electron.launch({
        args: [MAIN, workspace.dir],
        env: {
          ...process.env,
          TERMCO_USER_DATA: workspace.userData,
          TERMCO_E2E: "1",
          // Ephemeral MCP-server port so parallel E2E workers don't collide on
          // the fixed default (the test reads the actual URL back from the app).
          TERMCO_MCP_PORT: "0",
          // Uninstall tests only ever operate inside this throwaway userData.
          TERMCO_E2E_AUTO_CONFIRM_UNINSTALL: "1",
          // Ensure the production dist/ is loaded (no dev server).
          VITE_DEV_SERVER_URL: "",
        },
      });
    let app = await launch();
    try {
      await app.firstWindow({ timeout: 20_000 });
    } catch (firstError) {
      // macOS occasionally starts Electron without presenting its first window
      // after a long launch sweep. Dispose that exact process and retry once;
      // otherwise one launch-service hiccup burns the entire 90-second test.
      console.warn("[e2e] Electron presented no first window; retrying once", firstError);
      await closeElectronApp(app);
      app = await launch();
      await app.firstWindow({ timeout: 30_000 });
    }
    await use(app);
    await closeElectronApp(app);
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    const startup = collectErrors(page);
    await page.waitForLoadState("domcontentloaded");
    // Wait for the React shell + explorer to actually mount before any test runs.
    try {
      await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      const body = (await page.locator("body").innerText()).slice(0, 2_000);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n` +
          `Renderer startup errors:\n${startup.errors.join("\n") || "<none>"}\n` +
          `Rendered body:\n${body || "<empty>"}`,
      );
    }
    await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 30_000 });
    await use(page);
  },
});

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  // A spec may deliberately close and restart its fixture-owned application to
  // verify persisted state. Playwright clears the underlying connection when
  // `app.close()` completes, so `app.process()` is no longer readable during
  // the fixture's final (idempotent) cleanup pass.
  let child: ReturnType<ElectronApplication["process"]>;
  try {
    child = app.process();
  } catch {
    return;
  }
  let graceful = false;
  await Promise.race([
    app.close().then(() => {
      graceful = true;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]).catch(() => {});
  if (graceful || child.exitCode !== null) return;

  console.warn(`[e2e] Electron pid ${child.pid ?? "unknown"} did not close; forcing cleanup`);
  child.kill("SIGKILL");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

/**
 * Variant that seeds the live OpenAI key BEFORE the app launches — the key has
 * to be on disk by the time the renderer loads its keyring. Specs using it must
 * skip themselves when `liveOpenAiKey()` is null.
 */
export const liveTest = test.extend({
  workspace: async ({}, use) => {
    const ws = seedWorkspace();
    const key = liveOpenAiKey();
    if (key) seedOpenAiKey(ws, key);
    const anthropic = liveAnthropicKey();
    if (anthropic) seedAnthropicKey(ws, anthropic);
    await use(ws);
  },
});

export { expect };

/** Console/page errors are benign in a few known cases; everything else fails. */
const BENIGN_ERROR = [
  /Content-Security-Policy/i,
  /Electron Security Warning/i,
  /aria-hidden/i,
  /Autofill\./i,
  /devtools/i,
  // LazyStore schreibt atomar (tmp-Datei + rename). Im Wegwerf-Profil eines
  // E2E-Laufs können zwei Speichervorgänge dicht aufeinander fallen, und das
  // rename findet seine tmp-Datei nicht mehr. Ein Wettlauf der Testumgebung,
  // kein Verhalten der App — er trat erst auf, als ein Spec anfing, KEINE
  // Konsolenfehler zu verlangen.
  /ENOENT.*rename.*\.tmp/i,
];

export function isBenignError(text: string): boolean {
  return BENIGN_ERROR.some((re) => re.test(text));
}

/** Attach a collector that records unexpected console.error / pageerror output. */
export function collectErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error" || isBenignError(msg.text())) return;
    const location = msg.location();
    errors.push(
      location.url
        ? `${msg.text()} (${location.url}:${location.lineNumber})`
        : msg.text(),
    );
  });
  page.on("pageerror", (err) => {
    if (!isBenignError(err.message)) errors.push(err.message);
  });
  return { errors };
}

/**
 * Open the in-window settings view and return the same Page. Settings is no
 * longer a separate OS window — it swaps in for the workspace body (like the
 * agents view). Clicks the header Settings button (robust regardless of focus)
 * rather than the Cmd+, shortcut, which an editor/terminal focus can swallow.
 */
export async function openSettingsWindow(
  _app: ElectronApplication,
  page: Page,
): Promise<Page> {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page
    .getByTestId("settings-view")
    .waitFor({ state: "visible", timeout: 15_000 });
  // Wait for the General *section content* (lazily rendered), not just the
  // rail, so controls are present before any inventory/interaction. The mode
  // cards moved to the Appearance tab in the settings redesign, so key off a
  // General row instead.
  await page
    .getByText("Launch at login", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  return page;
}

export const MOD = process.platform === "darwin" ? "Meta" : "Control";
