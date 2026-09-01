import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("SSH startup policy is a source-owned consumer of the shared provider", async ({ page, workspace }) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "ssh-auto-connect")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "ssh-auto-connect",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "ssh-auto-connect",
  );
  expect(profile.activationOrder).toContain("ssh-auto-connect");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "ssh-auto-connect",
    replacementId: "e2e.ssh-auto-connect",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.ssh-auto-connect");
  const manifest = join(source, "termco-plugin.json");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "order.ts"))).toBe(true);
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("SSH Startup Resume", "E2E SSH Startup Resume"),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.ssh-auto-connect"));
  expect(apply.status).toBe("replaced");
  const replaced = await page.evaluate(async () => (await window.__termco.rendererPluginProfile()).catalog);
  expect(replaced.find((entry) => entry.id === "e2e.ssh-auto-connect")?.name).toBe("E2E SSH Startup Resume (Custom)");
});
