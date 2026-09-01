import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TermcoProfileV3 } from "../src/platform/contracts";
import { MAIN } from "./fixtures";

test("a renderer-broken profile shows an explanation and activates protected recovery", async () => {
  const userData = mkdtempSync(join(tmpdir(), "termco-renderer-recovery-"));
  const profileId = "broken.renderer";
  const profileDirectory = join(
    userData,
    "plugin-platform",
    "profiles",
    "broken-renderer",
  );
  const defaults = JSON.parse(
    readFileSync(join(process.cwd(), "profiles/default/profile.json"), "utf8"),
  ) as TermcoProfileV3;
  const broken: TermcoProfileV3 = {
    ...defaults,
    id: profileId,
    plugins: defaults.plugins.map((row) =>
      row.id === "file-icons-native" ? { ...row, enabled: false } : row,
    ),
  };
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, "profile.json"), JSON.stringify(broken));
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
      TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  const child = app.process();
  try {
    const page = await app.firstWindow({ timeout: 20_000 });
    const startupRecovery = page.getByTestId("renderer-startup-recovery");
    await expect(startupRecovery).toBeVisible({ timeout: 20_000 });
    await expect(startupRecovery).toContainText("selected profile could not load");

    const recoveryNotice = page.getByTestId("safe-profile-recovery");
    await expect(recoveryNotice).toBeVisible({ timeout: 30_000 });
    await expect(recoveryNotice).toContainText(profileId);
    await expect(recoveryNotice).toContainText("ui.file-icons");
    await expect(page.getByTestId("sidebar")).toBeVisible();

    await expect
      .poll(() =>
        JSON.parse(
          readFileSync(
            join(userData, "plugin-platform", "active-profile.json"),
            "utf8",
          ),
        ).profileId,
      )
      .toBe("termco.safe-recovery");
    const preserved = JSON.parse(
      readFileSync(join(profileDirectory, "profile.json"), "utf8"),
    ) as TermcoProfileV3;
    expect(
      preserved.plugins.find((row) => row.id === "file-icons-native")?.enabled,
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
