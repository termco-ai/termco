/**
 * Per-rig chat, end-to-end through the real app: creating/visiting rigs
 * gives each its own canonical chat session, tagged by rig in the single global
 * session pool. No provider key is needed because a rig's chat is created on
 * rig switch (setCurrentRig), not on first message.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

type CanonicalSession = {
  sessionId: string;
  rigId?: string;
};

type ChatSessionState = {
  currentRigId: string;
  sessions: Array<{ id: string; rigId: string }>;
};

async function readCanonicalSessions(page: Page): Promise<CanonicalSession[]> {
  const result = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "ai-chat-native",
      capability: "session.history",
      method: "list",
      args: [{ limit: 100 }],
    })
  ) as { sessions: CanonicalSession[]; exhausted: boolean };
  expect(result.exhausted).toBe(true);
  return result.sessions;
}

async function readChatSessionState(page: Page): Promise<ChatSessionState> {
  return await page.evaluate(() => {
    const seam = (window as unknown as {
      __termcoE2E?: { aiSessionState?: () => ChatSessionState };
    }).__termcoE2E;
    if (!seam?.aiSessionState) throw new Error("AI session E2E state is unavailable");
    return seam.aiSessionState();
  });
}

test("each rig owns its own persisted chat, tagged by rig", async ({ page }) => {
  // Boot is complete (the page fixture waits for the workspace), so the default
  // rig already has a chat. Create two more rigs — creating a rig switches
  // to it, so each gets its own chat via setCurrentRig. The "New rig" button
  // opens the create-workspace chooser (local vs SSH); pick "Local workspace".
  const newRig = page
    .getByRole("button", { name: "New rig", exact: true })
    .first();
  const localRig = page.getByRole("button", { name: /Local workspace/ });
  await newRig.click();
  await localRig.click();
  await page.waitForTimeout(500);
  await newRig.click();
  await localRig.click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("workspace")).toBeVisible();

  // Three distinct rigs (default + 2 created), each owning at least one chat.
  // Poll because renderer-to-main canonical persistence is asynchronous.
  await expect
    .poll(
      async () =>
        new Set(
          (await readCanonicalSessions(page)).map(
            (s) => s.rigId,
          ),
        ).size,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(3);

  const sessions = await readCanonicalSessions(page);
  const state = await readChatSessionState(page);

  // Every chat is tagged to a rig — none left untagged (the global pool
  // invariant that makes re-homing on rig delete possible).
  expect(
    sessions.every((s) => typeof s.rigId === "string" && s.rigId.length > 0),
  ).toBe(true);

  // Chat's rebuildable presentation matches the canonical owner exactly.
  expect(
    state.sessions
      .map(({ id, rigId }) => ({ sessionId: id, rigId }))
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
  ).toEqual(
    sessions
      .map(({ sessionId, rigId }) => ({ sessionId, rigId }))
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
  );
  expect(state.sessions.some((session) => session.rigId === state.currentRigId)).toBe(true);
});
