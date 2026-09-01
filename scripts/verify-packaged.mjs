import { _electron as electron } from "@playwright/test";
import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { buildPluginRelease } from "../plugin-repository/scripts/build-plugin-release.mjs";

const executable = resolve(
  process.argv[2] ??
    "release/mac-arm64/Termco.app/Contents/MacOS/Termco",
);
const temporary = await fs.mkdtemp(join(tmpdir(), "termco-packaged-"));
const workspace = join(temporary, "workspace");
const sourceUserData = join(temporary, "source-user-data");
const destinationUserData = join(temporary, "destination-user-data");
const releaseUserData = join(temporary, "release-user-data");
const profilePackage = join(temporary, "packaged-plugin-update.termco-profile.zip");
const replacementId = "verify.packaged-preview";
const firstMessage = "Packaged ZIP plugin is active";
const updatedMessage = "Packaged ZIP plugin updated live";
const officialUpdateMessage = "Signed plugin release is active";
const openPreviewShortcut = `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+o`;
const applications = new Set();
let releaseServer = null;

await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(join(workspace, "README.md"), "# packaged verification\n");

function environment(userData, extra = {}) {
  return {
    ...process.env,
    TERMCO_USER_DATA: userData,
    TERMCO_E2E: "1",
    TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT: "1",
    TERMCO_MCP_PORT: "0",
    VITE_DEV_SERVER_URL: "",
    ...extra,
  };
}

async function launch(userData, extra = {}) {
  const capabilityFailures = [];
  const application = await electron.launch({
    executablePath: executable,
    args: [workspace],
    env: environment(userData, extra),
  });
  applications.add(application);
  const page = await application.firstWindow();
  page.on("console", (message) => {
    const value = message.text();
    if (/unknown command: (pty_open|store_get)/.test(value)) capabilityFailures.push(value);
    console.error(`[renderer:${message.type()}] ${value}`);
  });
  page.on("pageerror", (error) => {
    if (/unknown command: (pty_open|store_get)/.test(error.stack ?? error.message)) {
      capabilityFailures.push(error.stack ?? error.message);
    }
    console.error(`[renderer:error] ${error.stack}`);
  });
  try {
    await page.getByTestId("workspace").waitFor({
      state: "visible",
      timeout: 30_000,
    });
  } catch (error) {
    console.error(`packaged page URL: ${page.url()}`);
    console.error((await page.locator("body").innerText()).slice(0, 4_000));
    throw error;
  }
  await page.waitForTimeout(500);
  return { application, page, capabilityFailures };
}

async function close(run) {
  await run.application.close();
  applications.delete(run.application);
}

function assertCapabilitiesRegistered(run) {
  assert.deepEqual(
    run.capabilityFailures,
    [],
    "packaged startup invoked an unregistered PTY or storage capability command",
  );
}

async function copyReplacementDraft(page) {
  return page.evaluate(async ({ replacementId }) => {
    const profile = await window.__termco.rendererPluginProfile();
    const source = profile.catalog.find((plugin) => plugin.id === "preview-surface-native");
    if (!source) throw new Error("preview-surface-native was not found");
    const plan = await window.__termco.planPlugin({
      intent: "replace",
      plugin: {
        id: replacementId,
        name: "Packaged Preview Update",
        description: "Packaged ZIP and live-update verification plugin.",
        category: source.category,
      },
      sourcePluginId: source.id,
      target: "renderer-provider",
      contributions: [],
      reveal: "none",
    });
    return window.__termco.copyAndReplacePlugin(plan.planId);
  }, { replacementId });
}

async function replaceSourceMessage(page, from, to) {
  return page.evaluate(async ({ pluginId, from, to }) => {
    const path = "src/renderer.tsx";
    const source = await window.__termco.readPluginSourceFile(pluginId, path);
    if (!source.includes(from)) {
      throw new Error(`plugin source does not contain expected text: ${from}`);
    }
    await window.__termco.writePluginSourceFile(
      pluginId,
      path,
      source.replace(from, to),
    );
  }, { pluginId: replacementId, from, to });
}

async function assertPluginVersion(page, version) {
  const plugin = await page.evaluate(async (pluginId) => {
    const profile = await window.__termco.rendererPluginProfile();
    return profile.catalog.find((candidate) => candidate.id === pluginId);
  }, replacementId);
  assert.equal(plugin?.version, version);
  assert.equal(plugin?.replaces, "preview-surface-native");
}

async function assertCatalogPluginVersion(page, pluginId, version) {
  const plugin = await page.evaluate(async (id) => {
    const profile = await window.__termco.rendererPluginProfile();
    return profile.catalog.find((candidate) => candidate.id === id);
  }, pluginId);
  assert.equal(plugin?.version, version);
}

async function createSignedPluginReleaseFixture() {
  const repositoryRoot = join(temporary, "release-source");
  const pluginId = "preview-surface-native";
  const sourcePluginRoot = resolve("plugin-repository", "plugins", pluginId);
  const pluginRoot = join(repositoryRoot, "plugins", pluginId);
  await fs.mkdir(join(repositoryRoot, "plugins"), { recursive: true });
  const rootPackage = JSON.parse(await fs.readFile(resolve("package.json"), "utf8"));
  await fs.writeFile(
    join(repositoryRoot, "package.json"),
    `${JSON.stringify(rootPackage, null, 2)}\n`,
  );
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true });
  const manifestFile = join(pluginRoot, "termco-plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const currentPluginVersion = manifest.version;
  const versionParts = currentPluginVersion.split(".").map(Number);
  assert.equal(versionParts.length, 3);
  assert.ok(versionParts.every(Number.isSafeInteger));
  const pluginVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
  manifest.version = pluginVersion;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const rendererFile = join(pluginRoot, "src", "renderer.tsx");
  const renderer = await fs.readFile(rendererFile, "utf8");
  assert.ok(renderer.includes("Nothing to preview yet"));
  await fs.writeFile(
    rendererFile,
    renderer.replace("Nothing to preview yet", officialUpdateMessage),
  );
  for (const dependency of Object.keys(manifest.dependencies)) {
    if (!dependency.startsWith("@termco/") || !dependency.endsWith("-base")) continue;
    const packageName = dependency.slice("@termco/".length);
    const target = join(repositoryRoot, "plugins", packageName);
    await fs.mkdir(target, { recursive: true });
    await fs.copyFile(
      resolve("plugin-repository", "plugins", packageName, "package.json"),
      join(target, "package.json"),
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const releaseId = "plugins-packaged-verification-1";
  const built = await buildPluginRelease({
    repositoryRoot,
    outputRoot: "artifacts",
    releaseId,
    minApplicationVersion: rootPackage.version,
    pluginIds: [pluginId],
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyId: "packaged-verification",
    publishedAt: "2026-08-30T12:00:00.000Z",
    revokedReleaseIds: [],
  });
  assert.ok(built, "signed plugin release was not built");
  const manifestBytes = await fs.readFile(
    join(repositoryRoot, "artifacts", "termco-plugin-release.json"),
  );
  const archiveBytes = await fs.readFile(
    join(repositoryRoot, "artifacts", built.manifest.archive.assetName),
  );

  releaseServer = createServer((request, response) => {
    const origin = `http://127.0.0.1:${releaseServer.address().port}`;
    if (request.url === "/repos/local/termco-plugins/releases/latest") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        tag_name: releaseId,
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "termco-plugin-release.json",
            size: manifestBytes.byteLength,
            browser_download_url: `${origin}/manifest`,
          },
          {
            name: built.manifest.archive.assetName,
            size: archiveBytes.byteLength,
            browser_download_url: `${origin}/archive`,
          },
        ],
      }));
      return;
    }
    if (request.url === "/manifest") {
      response.setHeader("Content-Type", "application/json");
      response.end(manifestBytes);
      return;
    }
    if (request.url === "/archive") {
      response.setHeader("Content-Type", "application/zip");
      response.end(archiveBytes);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  releaseServer.listen(0, "127.0.0.1");
  await once(releaseServer, "listening");
  const address = releaseServer.address();
  assert.ok(address && typeof address === "object");
  return {
    pluginId,
    currentPluginVersion,
    pluginVersion,
    releaseId,
    environment: {
      TERMCO_PLUGIN_RELEASE_REPOSITORY: "local/termco-plugins",
      TERMCO_PLUGIN_RELEASE_KEY_ID: "packaged-verification",
      TERMCO_PLUGIN_RELEASE_PUBLIC_KEY: publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      TERMCO_PLUGIN_RELEASE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
  };
}

async function assertPreviewMessage(page, message) {
  await page.keyboard.press(openPreviewShortcut);
  await page.getByText(message, { exact: true }).filter({ visible: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

try {
  const source = await launch(sourceUserData, {
    TERMCO_E2E_PROFILE_EXPORT_PATH: profilePackage,
  });
  const applicationInfo = await source.page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "about-native",
      capability: "application.info",
      method: "getInfo",
      args: [],
    }),
  );
  assert.equal(applicationInfo.bundleId, "app.termco");
  assert.equal(typeof applicationInfo.version, "string");

  const draft = await copyReplacementDraft(source.page);
  assert.equal(draft.status, "draft");
  assert.equal(draft.pluginId, replacementId);
  await replaceSourceMessage(source.page, "Nothing to preview yet", firstMessage);
  const applied = await source.page.evaluate((pluginId) =>
    window.__termco.applyPlugin(pluginId), replacementId);
  assert.equal(applied.status, "replaced");
  assert.equal(typeof applied.generation, "string");
  await assertPluginVersion(source.page, "1.0.1");
  await assertPreviewMessage(source.page, firstMessage);

  const exported = await source.page.evaluate(() =>
    window.__termco.exportProfile({
      name: "Packaged Plugin Update",
      description: "Exercises ZIP import and live plugin activation.",
      version: "1.0.0",
    }),
  );
  assert.equal(exported.status, "exported");
  assert.equal(exported.packagedPluginCount, 1);
  assert.equal(exported.path, profilePackage);
  assert.ok((await fs.stat(profilePackage)).size > 0, "profile ZIP is empty");
  assertCapabilitiesRegistered(source);
  await close(source);

  const destination = await launch(destinationUserData, {
    TERMCO_E2E_PROFILE_IMPORT_PATH: profilePackage,
  });
  const imported = await destination.page.evaluate(() => window.__termco.importProfile());
  assert.equal(imported.status, "imported");
  assert.equal(imported.packagedPluginCount, 1);
  const activated = await destination.page.evaluate((profileId) =>
    window.__termco.activateProfile(profileId), imported.profileId);
  assert.equal(activated.status, "replaced");
  await assertPluginVersion(destination.page, "1.0.1");
  await assertPreviewMessage(destination.page, firstMessage);

  await replaceSourceMessage(destination.page, firstMessage, updatedMessage);
  const updated = await destination.page.evaluate((pluginId) =>
    window.__termco.applyPlugin(pluginId), replacementId);
  assert.equal(updated.status, "replaced");
  assert.equal(typeof updated.generation, "string");
  assert.notEqual(updated.generation, applied.generation);
  await assertPluginVersion(destination.page, "1.0.2");
  await destination.page.getByText(updatedMessage, { exact: true }).filter({ visible: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  assertCapabilitiesRegistered(destination);
  await close(destination);

  const restarted = await launch(destinationUserData);
  await assertPluginVersion(restarted.page, "1.0.2");
  await assertPreviewMessage(restarted.page, updatedMessage);
  assertCapabilitiesRegistered(restarted);
  await close(restarted);

  const releaseFixture = await createSignedPluginReleaseFixture();
  const releaseRun = await launch(releaseUserData, releaseFixture.environment);
  const checkedRelease = await releaseRun.page.evaluate(() =>
    window.__termco.checkPluginReleases(),
  );
  assert.equal(checkedRelease.kind, "available");
  assert.equal(checkedRelease.release.releaseId, releaseFixture.releaseId);
  assert.deepEqual(
    checkedRelease.release.plugins.map(({ id, currentVersion, version }) => ({
      id,
      currentVersion,
      version,
    })),
    [
      {
        id: releaseFixture.pluginId,
        currentVersion: releaseFixture.currentPluginVersion,
        version: releaseFixture.pluginVersion,
      },
    ],
  );
  const installedRelease = await releaseRun.page.evaluate((releaseId) =>
    window.__termco.installPluginRelease(releaseId), releaseFixture.releaseId);
  assert.equal(installedRelease.status, "installed");
  await assertCatalogPluginVersion(
    releaseRun.page,
    releaseFixture.pluginId,
    releaseFixture.pluginVersion,
  );
  await assertPreviewMessage(releaseRun.page, officialUpdateMessage);
  assertCapabilitiesRegistered(releaseRun);
  await close(releaseRun);

  const releaseRestart = await launch(
    releaseUserData,
    releaseFixture.environment,
  );
  await assertCatalogPluginVersion(
    releaseRestart.page,
    releaseFixture.pluginId,
    releaseFixture.pluginVersion,
  );
  await assertPreviewMessage(releaseRestart.page, officialUpdateMessage);
  assertCapabilitiesRegistered(releaseRestart);
  await close(releaseRestart);

  console.log("packaged ZIP import plus signed plugin-feed live update and restart persistence verified");
} finally {
  await Promise.allSettled([...applications].map((application) => application.close()));
  if (releaseServer) {
    await new Promise((resolveClose) => releaseServer.close(resolveClose));
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
