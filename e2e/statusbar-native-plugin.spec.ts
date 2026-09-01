import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  expect(source, `${label} source anchor`).toContain(search);
  return source.replace(search, replacement);
}

// @termco-certifies copy-replace statusbar-native source=src/items/ReadyDot.tsx runtime=E2E_STATUS_READY
test("status bar is registry-backed source-owned UI and live replaceable", async ({ page, workspace }) => {
  const statusbar = page.getByTestId("slot-statusbar");
  await expect(statusbar).toBeVisible();
  await expect(statusbar).toContainText("Ready");
  await expect(statusbar.getByRole("button", { name: "Open AI agent" })).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "statusbar-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "statusbar-native",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "statusbar-native",
  );
  expect(profile.activationOrder).toContain("statusbar-native");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "statusbar-native",
    replacementId: "e2e.statusbar-native",
  }));
  expect(result.status).toBe("replaced");
  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.statusbar-native",
  );
  const renderer = join(source, "src", "items", "ReadyDot.tsx");
  const manifestFile = join(source, "termco-plugin.json");
  const pluginEntrypoint = join(source, "src", "renderer.tsx");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "lib", "pathUtils.ts"))).toBe(true);
  writeFileSync(
    renderer,
    replaceRequired(
      readFileSync(renderer, "utf8"),
      "\n      Ready\n",
      "\n      E2E STATUS READY\n",
      "status label replacement",
    ),
  );
  const copiedManifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    dependencies: Record<string, string>;
  };
  copiedManifest.dependencies["@termco/ui-commands-base"] = "1.0.0";
  writeFileSync(manifestFile, `${JSON.stringify(copiedManifest, null, 2)}\n`);
  let copiedEntrypoint = replaceRequired(
    readFileSync(pluginEntrypoint, "utf8"),
    'import { AI_SESSIONS_SERVICE, type AiSessionsCapability } from "@termco/ai-sessions-base";',
    `import { AI_SESSIONS_SERVICE, type AiSessionsCapability } from "@termco/ai-sessions-base";
import {
  UI_COMMANDS_SERVICE,
  type UiCommandRegistry,
  type UiCommandSourceContribution,
} from "@termco/ui-commands-base";`,
    "ui.commands import",
  );
  copiedEntrypoint = replaceRequired(
    copiedEntrypoint,
    "  inject: [",
    "  inject: [UI_COMMANDS_SERVICE,",
    "ui.commands injection",
  );
  copiedEntrypoint = replaceRequired(
    copiedEntrypoint,
    "  },\n};\n\nconst NO_SUBSCRIBE",
    `    const commandSource: UiCommandSourceContribution = {
      id: "e2e-statusbar",
      commands: () => [{
        id: "e2e.statusbar.ping",
        title: "E2E Status: Ping",
        description: "E2E status-bar command.",
        group: "E2E Status",
        run: () => undefined,
      }],
    };
    await context.effect(() =>
      context.get<UiCommandRegistry>(UI_COMMANDS_SERVICE).register(
        commandSource,
        { pluginId: "e2e.statusbar-native", key: commandSource.id },
      ),
    );
  },
};

const NO_SUBSCRIBE`,
    "ui.commands contribution",
  );
  writeFileSync(
    pluginEntrypoint,
    copiedEntrypoint,
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.statusbar-native"));
  expect(apply.status).toBe("replaced");
  await expect(statusbar).toContainText("E2E STATUS READY", { timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "statusbar-native",
    "e2e.statusbar-native",
  );
  await openCommandPalette(page);
  await page.keyboard.type("E2E Status Ping");
  await expect(page.getByRole("option", { name: /E2E Status: Ping/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await revertWholeFolderReplacement(
    page,
    "statusbar-native",
    "e2e.statusbar-native",
  );
  await expect(statusbar).toContainText("Ready");
  await expect(statusbar).not.toContainText("E2E STATUS READY");
});

test("a separate right-side plugin composes into the active root status bar", async ({
  page,
  workspace,
}) => {
  const copied = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "statusbar-native",
    replacementId: "e2e.word-count-statusbar",
    name: "E2E Word Count Statusbar",
  }));
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.word-count-statusbar",
  );
  const sourceRoot = join(source, "src");
  rmSync(sourceRoot, {
    recursive: true,
    force: true,
  });
  mkdirSync(sourceRoot, { recursive: true });
  const manifestFile = join(source, "termco-plugin.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    replaces?: string;
    dependencies: Record<string, string>;
  };
  delete manifest.replaces;
  manifest.dependencies = {
    "@termco/kernel": "1.0.0",
    "@termco/ui-commands-base": "1.0.0",
    "@termco/ui-statusbar-base": "1.0.0",
    react: "^19.2.7",
  };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(source, "src", "renderer.tsx"),
    `import type { PluginModule } from "@termco/kernel";
import {
  UI_COMMANDS_SERVICE,
  type UiCommandSourceContribution,
  type UiCommandRegistry,
} from "@termco/ui-commands-base";
import {
  UI_STATUSBAR_ITEMS_SERVICE,
  type UiStatusbarItemContribution,
  type UiStatusbarItemRegistry,
} from "@termco/ui-statusbar-base";
import { useSyncExternalStore } from "react";

let pong = false;
const listeners = new Set<() => void>();
const state = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: () => pong,
  ping() {
    pong = true;
    listeners.forEach((listener) => listener());
    setTimeout(() => {
      pong = false;
      listeners.forEach((listener) => listener());
    }, 1500);
  },
};

export function wordCountLabel(isPong: boolean) {
  return isPong ? "WC: pong" : "WC: ready";
}

function WordCountItem() {
  const isPong = useSyncExternalStore(
    state.subscribe,
    state.snapshot,
    state.snapshot,
  );
  return <span data-testid="word-count-statusbar">{wordCountLabel(isPong)}</span>;
}

const plugin: PluginModule = {
  inject: [UI_COMMANDS_SERVICE, UI_STATUSBAR_ITEMS_SERVICE],
  async activate(context) {
    const item: UiStatusbarItemContribution = {
      id: "word-count-statusbar",
      label: "Word Count",
      description: "Word-count proof of concept.",
      side: "right",
      order: 100,
      Component: WordCountItem,
    };
    await context.effect(() =>
      context.get<UiStatusbarItemRegistry>(UI_STATUSBAR_ITEMS_SERVICE).register(
        item,
        { pluginId: "e2e.word-count-statusbar", key: item.id },
      ),
    );
    const commands: UiCommandSourceContribution = {
      id: "word-count-statusbar",
      commands: () => [{
        id: "word-count.ping",
        title: "Word Count: Ping",
        group: "Word Count",
        run: state.ping,
      }],
    };
    await context.effect(() =>
      context.get<UiCommandRegistry>(UI_COMMANDS_SERVICE).register(
        commands,
        { pluginId: "e2e.word-count-statusbar", key: commands.id },
      ),
    );
  },
};

export default plugin;
`,
  );
  writeFileSync(
    join(source, "src", "renderer.test.ts"),
    `import { describe, expect, it } from "vitest";
import { wordCountLabel } from "./renderer";

describe("word-count statusbar", () => {
  it("projects ready and pong states", () => {
    expect(wordCountLabel(false)).toBe("WC: ready");
    expect(wordCountLabel(true)).toBe("WC: pong");
  });
});
`,
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.word-count-statusbar"),
  );
  expect(reloaded.status).toBe("replaced");

  const profileId = "termco.e2e.word-count-statusbar";
  const defaultProfile = JSON.parse(
    readFileSync(
      join(process.cwd(), "profiles", "default", "profile.json"),
      "utf8",
    ),
  ) as { plugins: unknown[] };
  const profileDirectory = join(
    workspace.userData,
    "plugin-platform",
    "profiles",
    profileId,
  );
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(
    join(profileDirectory, "profile.json"),
    `${JSON.stringify({
      ...defaultProfile,
      id: profileId,
      plugins: [
        ...defaultProfile.plugins,
        { id: "e2e.word-count-statusbar", module: source },
      ],
    }, null, 2)}\n`,
  );
  const activated = await page.evaluate((id) =>
    window.__termco.activateProfile(id), profileId,
  );
  expect(activated.status).toBe("replaced");

  const statusbar = page.getByTestId("slot-statusbar");
  await expect(statusbar).toContainText("Ready");
  await expect(page.getByTestId("word-count-statusbar")).toHaveText("WC: ready");

  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(catalog.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["statusbar-native", "e2e.word-count-statusbar"]),
  );

  await openCommandPalette(page);
  await page.keyboard.type("Word Count Ping");
  await page.getByRole("option", { name: /Word Count: Ping/ }).click();
  await expect(page.getByTestId("word-count-statusbar")).toHaveText("WC: pong");

  const uninstalled = await page.evaluate(() =>
    window.__termco.uninstallPlugin("e2e.word-count-statusbar"),
  );
  expect(uninstalled.status).toBe("uninstalled");
  await expect(page.getByTestId("word-count-statusbar")).toHaveCount(0);
  await expect(statusbar).toContainText("Ready");
});
