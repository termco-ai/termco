import { expect, openSettingsWindow, test } from "./fixtures";

test("runs, closes, resumes, and replays plugin-contributed onboarding", async ({ app, page }) => {
  const settings = await openSettingsWindow(app, page);
  const gettingStarted = settings.getByRole("button", {
    name: "Getting started",
    exact: true,
  }).first();
  await expect(gettingStarted).toBeVisible({ timeout: 15_000 });
  await gettingStarted.click();

  const section = settings.getByTestId("onboarding-section");
  await expect(section).toBeVisible();
  await expect(section.locator('[data-testid^="onboarding-journey-"]')).toHaveCount(12);
  await expect(section.getByText("Start working in Termco")).toBeVisible();
  await expect(section.getByText("Work with AI in Termco")).toBeVisible();
  await expect(section.getByText("Choose and create AI agents")).toBeVisible();
  await expect(section.getByText("Manage containers on any rig")).toBeVisible();
  await expect(section.getByText("Run and control coding agents")).toBeVisible();
  await expect(section.getByText("Create and share a Termco profile")).toBeVisible();

  const company = section.getByTestId("onboarding-journey-termco.extend-and-share");
  await company.getByRole("button", { name: "Start" }).click();

  const coach = settings.getByTestId("onboarding-coach-mark");
  await expect(coach).toBeVisible();
  await expect(coach.getByText("Start from the live plugin composition")).toBeVisible();
  await expect(settings.getByTestId("plugins-section")).toBeVisible();
  await expect(settings.locator(".border-primary").first()).toBeVisible();

  await coach.getByRole("button", { name: "Next" }).click();
  await expect(coach.getByText("Change an existing feature or create a new one")).toBeVisible();
  await expect(settings.locator('[data-testid^="profile-plugin-copy-"]').first()).toBeVisible();
  await coach.getByRole("button", { name: "Next" }).click();
  await expect(coach.getByText("Create the company profile")).toBeVisible();
  await expect(settings.getByTestId("profiles-section")).toBeVisible();

  await coach.getByRole("button", { name: "Close onboarding" }).click();
  await expect(coach).toHaveCount(0);
  await gettingStarted.click();
  await expect(company.getByText("2/4")).toBeVisible();
  await company.getByRole("button", { name: "Continue" }).click();
  await expect(coach.getByText("Create the company profile")).toBeVisible();
  await coach.getByRole("button", { name: "Next" }).click();
  await expect(coach.getByText("Validate the handoff before activation")).toBeVisible();
  await coach.getByRole("button", { name: "Finish" }).click();
  await expect(coach).toHaveCount(0);

  await gettingStarted.click();
  await expect(company.getByText("4/4")).toBeVisible();
  await expect(company.getByRole("button", { name: "Replay" })).toBeVisible();
});
