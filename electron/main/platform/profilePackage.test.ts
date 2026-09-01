import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { TermcoProfileV3 } from "../../../src/platform/contracts";
import {
  createProfilePackage,
  parseProfilePackage,
  writeParsedProfilePackage,
} from "./profilePackage";

async function plugin(root: string): Promise<string> {
  const directory = join(root, "company-dog-facts");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "termco-plugin.json"), JSON.stringify({
    schemaVersion: 3,
    id: "company-dog-facts",
    name: "Company Dog Facts",
    description: "Shows a company dog fact card.",
    category: "Company",
    version: "1.2.0",
    entrypoints: { renderer: "src/index.ts" },
    dependencies: { "@termco/kernel": "1.0.0" },
  }));
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "@company/dog-facts",
    version: "1.2.0",
    type: "module",
  }));
  await writeFile(join(directory, "src/index.ts"), "export default {};\n");
  await mkdir(join(directory, "node_modules", "secret-package"), { recursive: true });
  await writeFile(join(directory, "node_modules/secret-package/token"), "must-not-export");
  await writeFile(join(directory, "secrets.json"), "must-not-export");
  return directory;
}

function profile(module: string): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id: "termco.user.current",
    bundles: [],
    plugins: [
      { id: "settings-native", module: "bundled:core-plugins/settings-native" },
      { id: "company-dog-facts", module },
    ],
    patches: [],
  };
}

describe("Profile Packages", () => {
  it("exports deterministically, embeds complete user plugin source, and excludes secrets and caches", async () => {
    const root = await mkdtemp(join(tmpdir(), "termco-profile-package-"));
    const source = await plugin(root);
    const input = {
      id: "company.acme.developer",
      name: "Acme Developer",
      description: "Acme's Termco setup.",
      version: "1.0.0",
      termcoVersion: "0.8.2",
      profile: profile(source),
      defaults: { theme: "dark", editorWordWrap: true, defaultModelId: "gpt-5.4" },
      pluginSources: [{
        rowId: "company-dog-facts",
        pluginId: "company-dog-facts",
        version: "1.2.0",
        root: source,
      }],
    } as const;

    const first = await createProfilePackage(input);
    const second = await createProfilePackage(input);
    expect(first.bytes).toEqual(second.bytes);
    const parsed = parseProfilePackage(first.bytes);
    expect(parsed.manifest).toMatchObject({
      id: "company.acme.developer",
      name: "Acme Developer",
      version: "1.0.0",
      plugins: [{ pluginId: "company-dog-facts", version: "1.2.0" }],
    });
    expect(parsed.profile.plugins[1]?.module).toBe("package:plugins/company-dog-facts");
    expect(parsed.defaults.values).toEqual({
      defaultModelId: "gpt-5.4",
      editorWordWrap: true,
      theme: "dark",
    });
    expect([...parsed.files.keys()]).toContain("plugins/company-dog-facts/src/index.ts");
    expect([...parsed.files.keys()].some((path) => path.includes("node_modules"))).toBe(false);
    expect(Buffer.from(first.bytes).includes(Buffer.from("must-not-export"))).toBe(false);
  });

  it("rejects preferences that are private or not explicitly portable", async () => {
    const root = await mkdtemp(join(tmpdir(), "termco-profile-package-"));
    const source = await plugin(root);
    await expect(createProfilePackage({
      id: "company.acme.developer",
      name: "Acme Developer",
      description: "",
      version: "1.0.0",
      termcoVersion: "0.8.2",
      profile: profile(source),
      defaults: { "onboarding.progress.v1": { secret: true } },
      pluginSources: [{ rowId: "company-dog-facts", pluginId: "company-dog-facts", version: "1.2.0", root: source }],
    })).rejects.toThrow("unsupported preference");
  });

  it("rejects traversal, case collisions, tampering, and source symlinks", async () => {
    const traversal = zipSync({ "../escape": strToU8("bad") });
    expect(() => parseProfilePackage(traversal)).toThrow("unsafe archive path");

    const collision = zipSync({ "A/file": strToU8("one"), "a/FILE": strToU8("two") });
    expect(() => parseProfilePackage(collision)).toThrow("duplicate archive path");

    const root = await mkdtemp(join(tmpdir(), "termco-profile-package-"));
    const source = await plugin(root);
    const created = await createProfilePackage({
      id: "company.acme.developer",
      name: "Acme Developer",
      description: "",
      version: "1.0.0",
      termcoVersion: "0.8.2",
      profile: profile(source),
      pluginSources: [{ rowId: "company-dog-facts", pluginId: "company-dog-facts", version: "1.2.0", root: source }],
    });
    const entries = unzipSync(created.bytes);
    entries["plugins/company-dog-facts/src/index.ts"] = strToU8("tampered");
    expect(() => parseProfilePackage(zipSync(entries))).toThrow("integrity validation");

    await symlink(join(source, "src/index.ts"), join(source, "linked.ts"));
    await expect(createProfilePackage({
      id: "company.acme.developer",
      name: "Acme Developer",
      description: "",
      version: "1.0.0",
      termcoVersion: "0.8.2",
      profile: profile(source),
      pluginSources: [{ rowId: "company-dog-facts", pluginId: "company-dog-facts", version: "1.2.0", root: source }],
    })).rejects.toThrow("symbolic link");
  });

  it("writes only validated contained package files", async () => {
    const root = await mkdtemp(join(tmpdir(), "termco-profile-package-"));
    const source = await plugin(root);
    const created = await createProfilePackage({
      id: "company.acme.developer",
      name: "Acme Developer",
      description: "",
      version: "1.0.0",
      termcoVersion: "0.8.2",
      profile: profile(source),
      pluginSources: [{ rowId: "company-dog-facts", pluginId: "company-dog-facts", version: "1.2.0", root: source }],
    });
    const parsed = parseProfilePackage(created.bytes);
    const target = join(root, "installed");
    await writeParsedProfilePackage(parsed, target);
    expect(await readFile(join(target, "plugins/company-dog-facts/src/index.ts"), "utf8"))
      .toBe("export default {};\n");
  });
});
