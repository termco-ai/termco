import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TermcoProfileV3 } from "../src/platform/contracts";
import { MAIN } from "./fixtures";

const RECENT_STABLE_PROVIDERS = [
  "application-identity-native",
  "ai-registry-native",
  "ai-session-state-native",
  "file-icons-native",
] as const;

test("cold boot reconciles an app-generated profile with current shipped plugins", async () => {
  const userData = mkdtempSync(join(tmpdir(), "termco-profile-reconciliation-"));
  const profileId = `termco.user.${Date.now()}.deadbeef`;
  const profileFile = join(
    userData,
    "plugin-platform",
    "profiles",
    profileId,
    "profile.json",
  );
  const defaults = JSON.parse(
    readFileSync(join(process.cwd(), "profiles/default/profile.json"), "utf8"),
  ) as TermcoProfileV3;
  const incompleteProfile: TermcoProfileV3 = {
    ...defaults,
    id: profileId,
    plugins: defaults.plugins
      .filter((row) => !RECENT_STABLE_PROVIDERS.includes(row.id as never))
      .map((row) =>
        row.id === "git-surface" ? { ...row, enabled: false } : row,
      ),
  };
  mkdirSync(join(userData, "plugin-platform", "profiles", profileId), {
    recursive: true,
  });
  writeFileSync(profileFile, JSON.stringify(incompleteProfile));
  writeFileSync(
    join(userData, "plugin-platform", "active-profile.json"),
    JSON.stringify({ profileId }),
  );

  const app = await electron.launch({
    args: [MAIN, process.cwd()],
    env: {
      ...process.env,
      TERMCO_USER_DATA: userData,
      TERMCO_E2E: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  const child = app.process();
  try {
    const page = await app.firstWindow({ timeout: 20_000 });
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 30_000 });
    const reconciled = JSON.parse(readFileSync(profileFile, "utf8")) as TermcoProfileV3;
    expect(reconciled.plugins.map((row) => row.id)).toEqual(
      expect.arrayContaining([...RECENT_STABLE_PROVIDERS]),
    );
    expect(
      reconciled.plugins.find((row) => row.id === "git-surface")?.enabled,
    ).toBe(false);
  } finally {
    let closed = false;
    await Promise.race([
      app.close().then(() => {
        closed = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).catch(() => {});
    if (!closed && child.exitCode === null) child.kill("SIGKILL");
  }
});
