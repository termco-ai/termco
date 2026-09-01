import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace files-native source=src/main.ts runtime=edited_files_provider_is_active
test("the shared files provider is complete, editable, and replaceable live", async ({
  page,
  workspace,
}) => {
  const read = (path: string) =>
    page.evaluate(
      ({ target }) =>
        window.__termco.capabilityCall({
          consumerPluginId: "search-sidebar",
          capability: "workspace.files",
          method: "readFile",
          args: [target, { kind: "local" }, false],
        }),
      { target: path },
    );

  await expect(read(join(workspace.dir, "README.md"))).resolves.toMatchObject({
    kind: "text",
    content: expect.stringContaining("Termco E2E"),
  });

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "files-native")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "files-native",
    entrypoints: { renderer: "src/renderer.ts" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "files-native",
  );
  expect(profile.activationOrder).toContain("files-native");

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "files-native",
      replacementId: "e2e.files-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.files-native");
  const main = join(source, "src", "main.ts");
  for (const relative of [
    "src/main.ts",
    "src/file.ts",
    "src/tree.ts",
    "src/search.ts",
    "src/grep.ts",
    "src/mutate.ts",
    "src/watch.ts",
  ]) {
    expect(existsSync(join(source, relative))).toBe(true);
  }

  const before = readFileSync(main, "utf8");
  const after = before.replace(
    "      async readFile(path, environment, optional) {\n",
    "      async readFile(path, environment, optional) {\n" +
      '        if (path.endsWith("E2E_PROVIDER_MARKER.txt")) {\n' +
      '          return { kind: "text", content: "edited files provider is active", size: 31 };\n' +
      "        }\n",
  );
  expect(after).not.toBe(before);
  writeFileSync(main, after);

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.files-native"),
  );
  expect(reloaded.status).toBe("replaced");

  await expect(
    read(join(workspace.dir, "E2E_PROVIDER_MARKER.txt")),
  ).resolves.toEqual({
    kind: "text",
    content: "edited files provider is active",
    size: 31,
  });
  await expect(
    page.getByRole("button", { name: "README.md", exact: true }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    page,
    "files-native",
    "e2e.files-native",
  );

  await revertWholeFolderReplacement(
    page,
    "files-native",
    "e2e.files-native",
  );
  await expect(read(join(workspace.dir, "README.md"))).resolves.toMatchObject({
    kind: "text",
    content: expect.stringContaining("Termco E2E"),
  });
});
