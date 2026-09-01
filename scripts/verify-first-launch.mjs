import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { _electron as electron } from "@playwright/test";

const executable = resolve(
  process.argv[2] ?? "release/mac-arm64/Termco.app/Contents/MacOS/Termco",
);
const screenshot = resolve(
  process.argv[3] ?? join(tmpdir(), "termco-first-launch-setup.png"),
);
const localReleaseRoot = process.env.TERMCO_TEST_PLUGIN_RELEASE_DIR
  ? resolve(process.env.TERMCO_TEST_PLUGIN_RELEASE_DIR)
  : null;
const temporary = await fs.mkdtemp(join(tmpdir(), "termco-first-launch-"));
const userData = join(temporary, "user-data");
const workspace = join(temporary, "workspace");
const applications = new Set();
let updateServer = null;

await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(join(workspace, "README.md"), "# First-launch verification\n");

function environment(extra = {}) {
  return {
    ...process.env,
    TERMCO_USER_DATA: userData,
    TERMCO_E2E: "1",
    TERMCO_MCP_PORT: "0",
    VITE_DEV_SERVER_URL: "",
    ...extra,
  };
}

async function launch(extra = {}) {
  const logs = [];
  const application = await electron.launch({
    executablePath: executable,
    args: [workspace],
    env: environment(extra),
  });
  applications.add(application);
  const process = application.process();
  process.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  process.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  process.on("exit", (code, signal) => {
    logs.push(`[main:exit] code=${String(code)} signal=${String(signal)}\n`);
  });
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("console", (message) => logs.push(`[renderer:${message.type()}] ${message.text()}\n`));
  page.on("pageerror", (error) => logs.push(`[renderer:error] ${error.stack ?? error.message}\n`));
  return { application, page, logs };
}

async function close(run) {
  let timeout;
  try {
    const closed = new Promise((resolve) => {
      run.application.once("close", resolve);
    });
    await run.application.evaluate(({ app }) => {
      setImmediate(() => app.quit());
    });
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("packaged application did not quit within 15 seconds")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    applications.delete(run.application);
  }
}

async function directories(path) {
  return (await fs.readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function filesNamed(root, name) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === name) matches.push(path);
    }
  }
  await visit(root);
  return matches;
}

function diagnostics(run) {
  return run.logs.join("").slice(-20_000);
}

async function waitFor(predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("automatic plugin update check did not reach the feed");
}

async function observedUpdateFeed(releaseId) {
  const manifestResponse = await fetch(
    `https://github.com/termco-ai/termco-plugin-releases/releases/download/${releaseId}/termco-plugin-release.json`,
  );
  assert.equal(manifestResponse.ok, true);
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const requests = { latest: 0, manifest: 0 };
  updateServer = createServer((request, response) => {
    const address = updateServer.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    if (
      request.url ===
      "/repos/termco-ai/termco-plugin-releases/releases/latest"
    ) {
      requests.latest += 1;
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
            name: manifest.archive.assetName,
            size: manifest.archive.size,
            browser_download_url: `${origin}/archive`,
          },
        ],
      }));
      return;
    }
    if (request.url === "/manifest") {
      requests.manifest += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(manifestBytes);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  updateServer.listen(0, "127.0.0.1");
  await once(updateServer, "listening");
  const address = updateServer.address();
  assert.ok(address && typeof address === "object");
  return {
    requests,
    environment: {
      TERMCO_PLUGIN_RELEASE_REPOSITORY:
        "termco-ai/termco-plugin-releases",
      TERMCO_PLUGIN_RELEASE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
  };
}

async function localPluginFeed(root) {
  const manifestBytes = await fs.readFile(
    join(root, "termco-plugin-release.json"),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const archiveBytes = await fs.readFile(
    join(root, manifest.archive.assetName),
  );
  const requests = { latest: 0, manifest: 0, archive: 0 };
  updateServer = createServer((request, response) => {
    const address = updateServer.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    if (request.url === "/repos/local/termco-plugins/releases/latest") {
      requests.latest += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        tag_name: manifest.releaseId,
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "termco-plugin-release.json",
            size: manifestBytes.byteLength,
            browser_download_url: `${origin}/manifest`,
          },
          {
            name: manifest.archive.assetName,
            size: archiveBytes.byteLength,
            browser_download_url: `${origin}/archive`,
          },
        ],
      }));
      return;
    }
    if (request.url === "/manifest") {
      requests.manifest += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(manifestBytes);
      return;
    }
    if (request.url === "/archive") {
      requests.archive += 1;
      response.setHeader("Content-Type", "application/zip");
      response.end(archiveBytes);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  updateServer.listen(0, "127.0.0.1");
  await once(updateServer, "listening");
  const address = updateServer.address();
  assert.ok(address && typeof address === "object");
  return {
    requests,
    resetRequests() {
      requests.latest = 0;
      requests.manifest = 0;
      requests.archive = 0;
    },
    environment: {
      TERMCO_PLUGIN_RELEASE_REPOSITORY: "local/termco-plugins",
      TERMCO_PLUGIN_RELEASE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
  };
}

async function renderedBody(run) {
  try {
    return (await run.page.locator("body").innerText()).slice(0, 5_000);
  } catch (error) {
    return `<renderer unavailable: ${String(error)}>`;
  }
}

try {
  const bootstrapFeed = localReleaseRoot
    ? await localPluginFeed(localReleaseRoot)
    : null;
  const first = await launch(bootstrapFeed?.environment);
  try {
    const setup = first.page.getByTestId("first-launch-setup");
    await setup.waitFor({ state: "visible", timeout: 30_000 });
    const setupText = await setup.innerText();
    assert.match(setupText, /Official plugin set/i);
    assert.match(
      setupText,
      localReleaseRoot
        ? /local\/termco-plugins/
        : /termco-ai\/termco-plugin-releases/,
    );
    await first.page.screenshot({ path: screenshot, fullPage: true });
    await Promise.race([
      first.page.getByTestId("workspace").waitFor({
        state: "visible",
        timeout: 10 * 60_000,
      }),
      first.page.locator(".termco-setup__error").waitFor({
        state: "visible",
        timeout: 10 * 60_000,
      }).then(async () => {
        throw new Error(
          `first-launch setup failed: ${await first.page.locator(".termco-setup__error").innerText()}`,
        );
      }),
    ]);
    if (localReleaseRoot) {
      const secret = "termco-safe-storage-verification-plaintext";
      const setAndRead = await first.page.evaluate(async ({ secret }) => {
        const call = (method, args) => window.__termco.capabilityCall({
          consumerPluginId: "models-settings",
          capability: "secrets.application",
          method,
          args,
        });
        await call("set", ["termco-ai", "safe-storage-verification", secret]);
        return call("get", ["termco-ai", "safe-storage-verification"]);
      }, { secret });
      assert.equal(setAndRead, secret);
      const ciphertext = await fs.readFile(
        join(userData, "secrets.safe-storage.json"),
        "utf8",
      );
      assert.equal(ciphertext.includes(secret), false);
    }
  } catch (error) {
    console.error(await renderedBody(first));
    console.error(diagnostics(first));
    throw error;
  }

  const platformRoot = join(userData, "plugin-platform");
  const releaseState = JSON.parse(
    await fs.readFile(join(platformRoot, "plugin-releases.json"), "utf8"),
  );
  assert.match(
    releaseState.activeReleaseId,
    /^plugins-\d+\.\d+\.\d+(?:\.\d+)+$/,
  );
  const sourceRoot = join(
    platformRoot,
    "official-plugins",
    releaseState.activeReleaseId,
    "plugins",
  );
  const sourcePlugins = await directories(sourceRoot);
  const cacheRoot = join(platformRoot, "cache");
  const cachedPlugins = await directories(cacheRoot);
  assert.equal(sourcePlugins.length, 100);
  assert.equal(cachedPlugins.length, 100);
  assert.deepEqual(await filesNamed(sourceRoot, "AGENTS.md"), []);
  if (process.platform !== "win32") {
    const spawnHelpers = await filesNamed(
      join(cacheRoot, "pty-native"),
      "spawn-helper",
    );
    assert.ok(spawnHelpers.length > 0);
    for (const helper of spawnHelpers) {
      assert.notEqual((await fs.stat(helper)).mode & 0o111, 0);
    }
  }
  const profile = JSON.parse(
    await fs.readFile(join(platformRoot, "profiles", "default", "profile.json"), "utf8"),
  );
  assert.equal(
    profile.plugins.filter((plugin) => plugin.module.startsWith("official:")).length,
    100,
  );
  assert.deepEqual(
    profile.plugins
      .filter((plugin) => plugin.module.startsWith("bundled:core-plugins/"))
      .map((plugin) => plugin.id)
      .sort(),
    [
      "plugin-manager-native",
      "settings-native",
      "ui-shell-native",
      "updater-native",
      "workspace-shell-native",
    ],
  );
  await close(first);

  bootstrapFeed?.resetRequests();
  const observedFeed = bootstrapFeed ??
    await observedUpdateFeed(releaseState.activeReleaseId);
  const restarted = await launch(observedFeed.environment);
  let automaticRestartRequests;
  try {
    await restarted.page.getByTestId("workspace").waitFor({
      state: "visible",
      timeout: 2 * 60_000,
    });
    assert.equal(await restarted.page.getByTestId("first-launch-setup").count(), 0);
    await waitFor(
      () =>
        observedFeed.requests.latest > 0 &&
        observedFeed.requests.manifest > 0,
    );
    assert.equal(observedFeed.requests.latest, 1);
    assert.equal(observedFeed.requests.manifest, 1);
    if ("archive" in observedFeed.requests) {
      assert.equal(observedFeed.requests.archive, 0);
    }
    automaticRestartRequests = {
      latest: observedFeed.requests.latest,
      manifest: observedFeed.requests.manifest,
    };
    if (localReleaseRoot) {
      const persisted = await restarted.page.evaluate(async () => {
        const call = (method, args) => window.__termco.capabilityCall({
          consumerPluginId: "models-settings",
          capability: "secrets.application",
          method,
          args,
        });
        const value = await call("get", [
          "termco-ai",
          "safe-storage-verification",
        ]);
        await call("delete", ["termco-ai", "safe-storage-verification"]);
        return value;
      });
      assert.equal(persisted, "termco-safe-storage-verification-plaintext");
    }
    const check = await restarted.page.evaluate(() =>
      window.__termco.checkPluginReleases(),
    );
    assert.deepEqual(check, { kind: "up-to-date" });
  } catch (error) {
    console.error(await renderedBody(restarted));
    console.error(diagnostics(restarted));
    throw error;
  }
  await close(restarted);

  console.log(JSON.stringify({
    status: "passed",
    releaseId: releaseState.activeReleaseId,
    sourcePlugins: sourcePlugins.length,
    cachedPlugins: cachedPlugins.length,
    automaticRestartRequests,
    restartUpdateCheck: "up-to-date",
    screenshot,
    userData,
  }, null, 2));
} finally {
  await Promise.all(
    [...applications].map((application) => application.close().catch(() => undefined)),
  );
  if (updateServer) {
    await new Promise((resolve) => updateServer.close(resolve));
  }
}
