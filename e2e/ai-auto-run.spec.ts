import { expect, test } from "./fixtures";
import { openAiConversation } from "./helpers";

type AiE2E = {
  aiEffectiveToolApproval(name: string, input: unknown): Promise<boolean>;
};

async function needsApproval(
  page: import("@playwright/test").Page,
  name: string,
  input: unknown,
): Promise<boolean> {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const seam = (window as unknown as { __termcoE2E?: AiE2E }).__termcoE2E;
    if (!seam) throw new Error("AI E2E seam is not active");
    return seam.aiEffectiveToolApproval(toolName, toolInput);
  }, { toolName: name, toolInput: input });
}

test("Auto run changes the live effective policy for native and plugin tools", async ({
  page,
}) => {
  await openAiConversation(page);
  const toggle = page.getByRole("button", { name: /Auto-run is off/i });
  await expect(toggle).toBeVisible();

  expect(await needsApproval(page, "write_file", {
    path: "auto-run-e2e.txt",
    content: "proof",
  })).toBe(true);
  expect(await needsApproval(page, "plugin_create", {
    id: "e2e.auto-run-probe",
    name: "Probe",
    description: "Probe",
    category: "Testing",
    target: "renderer-provider",
  })).toBe(true);
  expect(await needsApproval(page, "bash_run", { command: "pnpm test" }))
    .toBe(true);

  await toggle.click();
  await expect(page.getByRole("button", { name: /Auto-run is ON/i })).toBeVisible();

  expect(await needsApproval(page, "write_file", {
    path: "auto-run-e2e.txt",
    content: "proof",
  })).toBe(false);
  expect(await needsApproval(page, "plugin_create", {
    id: "e2e.auto-run-probe",
    name: "Probe",
    description: "Probe",
    category: "Testing",
    target: "renderer-provider",
  })).toBe(false);
  expect(await needsApproval(page, "bash_run", { command: "pnpm test" }))
    .toBe(false);
  expect(await needsApproval(page, "bash_run", { command: "sudo reboot" }))
    .toBe(true);

  await page.reload();
  await page.getByTestId("workspace").waitFor({ state: "visible" });
  await openAiConversation(page);
  await expect(page.getByRole("button", { name: /Auto-run is ON/i })).toBeVisible();
  expect(await needsApproval(page, "write_file", {
    path: "restored-auto-run.txt",
    content: "proof",
  })).toBe(false);
});
