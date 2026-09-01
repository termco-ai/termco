import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mergeMacUpdaterDocuments } from "../../scripts/merge-macos-updater-metadata.mjs";
import { packagedEsbuildBinary } from "../../scripts/packaged-esbuild-binary.mjs";
import {
  updaterMetadataPath,
  verifyUpdaterMetadata,
} from "../../scripts/verify-updater-metadata.mjs";

function normalizeWorkflowText(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

describe("release workflow platform metadata", () => {
  it("leaves the full CI workflow as an explicit manual action", async () => {
    const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
    expect(workflow.on).toEqual({ workflow_dispatch: null });
  });

  it.each([
    ".github/workflows/application-release.yml",
    ".github/workflows/ci.yml",
  ])("uses the runner's installed Node headers before installs in %s", async (path) => {
    const workflow = normalizeWorkflowText(await readFile(path, "utf8"));
    const installMarker = "      - run: pnpm install --frozen-lockfile";
    const sectionsBeforeInstalls = workflow.split(installMarker).slice(0, -1);

    expect(sectionsBeforeInstalls.length).toBeGreaterThan(0);
    for (const section of sectionsBeforeInstalls) {
      const setupIndex = section.lastIndexOf("- uses: actions/setup-node@");
      const headersIndex = section.lastIndexOf(
        "- name: Use installed Node headers",
      );
      expect(headersIndex).toBeGreaterThan(setupIndex);
      const headerStep = section.slice(headersIndex);
      expect(headerStep).toContain("if: runner.os == 'Linux'");
      expect(headerStep).toContain('test -f "$NODE_ROOT/include/node/node.h"');
      expect(headerStep).toContain(
        'echo "npm_package_config_node_gyp_nodedir=$NODE_ROOT" >> "$GITHUB_ENV"',
      );
    }
  });

  it.each([
    ["macos", "latest-mac.yml"],
    ["windows", "latest.yml"],
    ["linux", "latest-linux.yml"],
  ])("maps %s to its electron-updater metadata", (platform, file) => {
    expect(updaterMetadataPath(platform, "release-root")).toBe(
      join(process.cwd(), "release-root", file),
    );
  });

  it("rejects unknown matrix platforms", () => {
    expect(() => updaterMetadataPath("freebsd")).toThrow(
      "unsupported release platform: freebsd",
    );
  });

  it("uses a GitHub-safe Windows installer name matching updater metadata", async () => {
    const config = parse(await readFile("electron-builder.yml", "utf8"));
    expect(config.nsis.artifactName).toContain("-Setup-");
    expect(config.nsis.artifactName).not.toContain(" ");
  });

  it("places compiler libraries in the packaged platform", async () => {
    const config = parse(await readFile("electron-builder.yml", "utf8"));
    const esbuild = config.extraResources.find(
      (resource: { from?: string }) => resource.from === "node_modules/esbuild",
    );
    const typescript = config.extraResources.find(
      (resource: { from?: string }) =>
        resource.from === "node_modules/typescript",
    );
    expect(esbuild?.to).toBe("platform/node_modules/esbuild");
    expect(typescript?.to).toBe("platform/node_modules/typescript");
  });

  it.each([
    ["win32", "x64", ["@esbuild", "win32-x64", "esbuild.exe"]],
    ["darwin", "arm64", ["@esbuild", "darwin-arm64", "bin", "esbuild"]],
    ["darwin", "x64", ["@esbuild", "darwin-x64", "bin", "esbuild"]],
    ["linux", "x64", ["@esbuild", "linux-x64", "bin", "esbuild"]],
  ])("selects the packaged esbuild binary for %s-%s", (platform, arch, suffix) => {
    expect(packagedEsbuildBinary("resources", platform, arch)).toBe(
      join("resources", "app.asar.unpacked", "node_modules", ...suffix),
    );
  });

  it("builds each macOS architecture on its native runner", async () => {
    const workflow = normalizeWorkflowText(
      await readFile(".github/workflows/application-release.yml", "utf8"),
    );
    expect(workflow).toMatch(/id: macos-x64\n\s+os: macos-15-intel/);
    expect(workflow).toMatch(/id: macos-arm64\n\s+os: macos-15/);
    expect(workflow).not.toContain("--x64 --arm64");
  });

  it("checks workflow structure after a Windows CRLF checkout", () => {
    const workflow = normalizeWorkflowText(
      "- id: macos-x64\r\n  os: macos-15-intel\r\n",
    );
    expect(workflow).toMatch(/id: macos-x64\n\s+os: macos-15-intel/);
  });

  it("merges native macOS updater documents", () => {
    const x64 = {
      version: "0.9.0",
      files: [{ url: "Termco-0.9.0-mac.zip" }],
      path: "Termco-0.9.0-mac.zip",
      sha512: "x64",
    };
    const arm64 = {
      version: "0.9.0",
      files: [{ url: "Termco-0.9.0-arm64-mac.zip" }],
      path: "Termco-0.9.0-arm64-mac.zip",
      sha512: "arm64",
    };

    expect(mergeMacUpdaterDocuments(x64, arm64)).toEqual({
      ...x64,
      files: [...x64.files, ...arm64.files],
    });
  });

  it("rejects mismatched native macOS updater versions", () => {
    expect(() =>
      mergeMacUpdaterDocuments(
        { version: "0.9.0", files: [{ url: "x64.zip" }] },
        { version: "0.9.1", files: [{ url: "arm64.zip" }] },
      ),
    ).toThrow("macOS updater versions differ");
  });

  it("accepts metadata only when every referenced artifact exists", async () => {
    const releaseRoot = await mkdtemp(join(tmpdir(), "termco-release-"));
    await writeFile(join(releaseRoot, "Termco-Setup-0.9.0.exe"), "installer");
    await writeFile(
      join(releaseRoot, "latest.yml"),
      [
        "version: 0.9.0",
        "files:",
        "  - url: Termco-Setup-0.9.0.exe",
        "    sha512: fixture",
        "    size: 9",
      ].join("\n"),
    );

    await expect(verifyUpdaterMetadata("windows", releaseRoot)).resolves.toBe(
      join(releaseRoot, "latest.yml"),
    );
  });

  it("rejects metadata whose referenced artifact was renamed", async () => {
    const releaseRoot = await mkdtemp(join(tmpdir(), "termco-release-"));
    await writeFile(join(releaseRoot, "Termco.Setup.0.9.0.exe"), "installer");
    await writeFile(
      join(releaseRoot, "latest.yml"),
      [
        "version: 0.9.0",
        "files:",
        "  - url: Termco-Setup-0.9.0.exe",
        "    sha512: fixture",
        "    size: 9",
      ].join("\n"),
    );

    await expect(verifyUpdaterMetadata("windows", releaseRoot)).rejects.toThrow(
      "updater artifact referenced by latest.yml is missing: Termco-Setup-0.9.0.exe",
    );
  });
});
