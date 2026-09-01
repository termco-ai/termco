import { _electron as electron, expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAIN } from "./fixtures";

const VITE_ENTRY = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("could not allocate a Vite test port");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForVite(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before serving the renderer (${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

test("pnpm dev serves a browser-safe renderer that mounts the plugin shell", async () => {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const vite = spawn(
    process.execPath,
    [VITE_ENTRY, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let electronProcess: ChildProcess | undefined;
  try {
    await waitForVite(url, vite);
    app = await electron.launch({
      args: [MAIN, process.cwd()],
      env: {
        ...process.env,
        TERMCO_USER_DATA: mkdtempSync(join(tmpdir(), "termco-dev-e2e-")),
        TERMCO_E2E: "1",
        TERMCO_MCP_PORT: "0",
        VITE_DEV_SERVER_URL: url,
      },
    });
    electronProcess = app.process();
    const page = await app.firstWindow({ timeout: 20_000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 30_000 });
    expect(errors).not.toContainEqual(
      expect.stringMatching(/externalized for browser compatibility/i),
    );
  } finally {
    let closed = app === undefined;
    await Promise.race([
      app?.close().then(() => {
        closed = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).catch(() => {});
    if (!closed && electronProcess?.exitCode === null) {
      electronProcess.kill("SIGKILL");
    }
    if (vite.exitCode === null) vite.kill("SIGTERM");
  }
});
