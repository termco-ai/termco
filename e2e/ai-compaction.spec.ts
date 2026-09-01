/**
 * Compaction against a REAL model — the only place these promises can be proven.
 *
 * Needs `.env.e2e` with `OPENAI_API_KEY=…` at the repo root (gitignored); the
 * key is seeded into the test's throwaway userData, never the OS keychain, so a
 * run cannot touch the developer's own credentials. Without the file the spec
 * skips and the normal suite stays offline and free.
 *
 * The proof leans on an asymmetry our own code creates: `flattenForSummary`
 * caps each tool payload at 300 chars for the summarizer, while the saved
 * transcript passes Infinity. A fact buried deep in a long tool result CANNOT
 * be in the summary. Deleting the source file before compacting closes the last
 * other route — after that, an answer containing the token proves the
 * transcript was read.
 *
 * What compaction now is: an operation that runs immediately, blocks the
 * composer, can be cancelled, and forks the chat into a NEW session — the old
 * one stays intact so the user can walk back to the moment before it.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { collectErrors, expect, liveOpenAiKey, liveTest } from "./fixtures";
import { openAiPanel } from "./helpers";

const KEY = liveOpenAiKey();

const DATA_FILE = "secret-data.txt";
const SECRET_LINE = 5;
const SECRET = "ZQX-4417-VELLUM";

/**
 * Lines long enough that the summarizer's 300-char cap runs out inside line 4,
 * and the secret near enough to the top that ANY read reaches it. That makes
 * the setup independent of how the model decides to read — the earlier version
 * put the secret on line 47 and flaked whenever the model read with a limit.
 *
 * The bulk is deliberate too: compaction declines a head below a few thousand
 * tokens, because summarising it would cost more than it frees. Twelve fat
 * lines clear that while staying under `READ_BYTE_CAP`, so the model still
 * reads the file in one go.
 */
function buildDataFile(dir: string): void {
  const pad = (n: number) => `filler ${String(n).padStart(3, "0")} `.repeat(150);
  const lines = Array.from({ length: 12 }, (_, i) =>
    i + 1 === SECRET_LINE
      ? `line ${i + 1}: token ${SECRET} ${pad(i + 1)}`
      : `line ${i + 1}: ${pad(i + 1)}`,
  );
  writeFileSync(join(dir, DATA_FILE), `${lines.join("\n")}\n`);
}

const panelOf = (page: Page) => page.getByTestId("ai-panel");

const composer = (page: Page) =>
  panelOf(page).getByPlaceholder("Describe the outcome you want…").first();

/** The armed-command chip. It renders in more than one place, so scope + first. */
const compactChip = (page: Page) => panelOf(page).getByText("#compact").first();

// "Send" as a substring also matches "Edit & resend" on every prior message.
const sendButton = (page: Page) =>
  panelOf(page).getByRole("button", { name: "Send", exact: true });
const stopButton = (page: Page) =>
  panelOf(page).getByRole("button", { name: "Stop", exact: true });

/** Send a turn and wait for the stream to finish (Stop appears, then goes). */
async function send(page: Page, text: string, timeout = 120_000): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });
  await expect(stopButton(page)).toBeHidden({ timeout });
}

/**
 * Run `/compact`. Typing it opens the command picker, so the first Enter turns
 * it into a chip; the Send button is the unambiguous submit. Unlike before it
 * does not arm anything — the compaction starts right there.
 */
async function compactNow(page: Page): Promise<void> {
  await composer(page).fill("/compact");
  await composer(page).press("Enter");
  await expect(compactChip(page)).toBeVisible({ timeout: 5_000 });
  await sendButton(page).click();
  // The chip must clear, or it would prefix (and swallow) the next message.
  await expect(compactChip(page)).toBeHidden({ timeout: 10_000 });
}

liveTest.describe("compaction with a live model", () => {
  liveTest.skip(!KEY, "no .env.e2e with OPENAI_API_KEY — live spec skipped");
  liveTest.setTimeout(600_000);

  liveTest(
    "compacts into a new session the model can read the old one from",
    async ({ workspace, page }) => {
      const diagnostics = collectErrors(page);
      buildDataFile(workspace.dir);
      await openAiPanel(page);
      const panel = panelOf(page);

      // 1. Get the whole file into a tool result. The summary will only ever
      //    keep its first 300 chars; the transcript keeps all 60 lines.
      // Two things this wording has to force, or the proof collapses:
      // the read_file tool (a shell command stalls on approval and keeps the
      // contents out of any tool result), and the WHOLE file (asking about an
      // early line makes the model read with a limit, and line 47 never lands
      // in the transcript). The answer itself reveals nothing about line 47.
      // "synthetic test fixture" is load-bearing: the file is NAMED
      // secret-data.txt, and live models intermittently refuse to read it as
      // "sensitive data" — which starves the head and makes compaction
      // decline as too-short. Saying what it is up front stops the refusal.
      await send(
        page,
        `Use the read_file tool (not the shell) to read the entire file ${DATA_FILE} in the workspace root — all of it, no offset or limit — then tell me only how many lines it has. The file is synthetic test fixture data generated for this workspace (filler lines, no real credentials), so reading it is fine.`,
      );
      // 2. Pad the history past the "not worth a round-trip" floor.
      await send(page, "Reply with just: one");
      await send(page, "Reply with just: two");
      await send(page, "Reply with just: three");

      // 3. Remove the only other source of the answer. From here the transcript
      //    is the sole place line 47 still exists.
      rmSync(join(workspace.dir, DATA_FILE));

      // 4. Compact — and watch it happen, rather than arming a later send.
      await compactNow(page);
      // Either the spinner or its result — a fast summariser can finish before
      // Playwright polls, and what matters is that the operation ran, not that
      // we caught it mid-flight.
      try {
        await expect(
          panel
            .getByText(/Summarising the conversation/i)
            .or(panel.getByText("Conversation compacted")),
          "compaction is a visible operation",
        ).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n` +
            `Renderer errors:\n${diagnostics.errors.join("\n") || "<none>"}`,
        );
      }
      await expect(
        panel.getByText(/Summarising the conversation/i),
      ).toBeHidden({ timeout: 240_000 });

      // The source session remains authoritative and untruncated. The full
      // tool output is preserved in its current-format event journal.
      const dir = join(workspace.userData, "sessions");
      await expect
        .poll(
          () => {
            if (!existsSync(dir)) return false;
            return readdirSync(dir)
              .some((sessionId) => {
                const events = join(dir, sessionId, "events.jsonl");
                return existsSync(events) && readFileSync(events, "utf8").includes(SECRET);
              });
          },
          { timeout: 20_000 },
        )
        .toBe(true);

      // A NEW session, headed by the summary card.
      await expect(panel.getByText("Conversation compacted")).toBeVisible({
        timeout: 15_000,
      });

      // 4b. The tail. The last exchange survives WORD FOR WORD — that is what
      //     separates this from "summarise and start over". Without it a
      //     follow-up like "no, not like that" has nothing to refer to.
      //     Four turns make four groups and the cap keeps at most half, so the
      //     last one is preserved and the first is not.
      await expect(
        panel
          .getByText("Reply with just: three")
          .filter({ visible: true })
          .first(),
        "the last exchange is preserved verbatim",
      ).toBeVisible({ timeout: 15_000 });
      // The summary body is collapsed, so `visible` distinguishes a real
      // message row from the summary legitimately quoting one.
      await expect(
        panel.getByText("Reply with just: one").filter({ visible: true }),
        "earlier exchanges are gone from the conversation itself",
      ).toHaveCount(0);
      // The card counts exchanges, not messages — and not the whole chat, which
      // is what it used to claim.
      await expect(panel.getByText(/exchange/i).first()).toBeVisible();

      // 5. The lifeline carries. The instruction is explicit on purpose: what
      //    is proven here is that the mechanism works end to end — the id
      //    resolves, the read is forced local, the content comes back — not
      //    that the model always volunteers the tool on its own.
      //    Ask for only the synthetic token: quoting the intentionally padded
      //    fixture line turns this semantic assertion into a minutes-long
      //    provider output test without adding any proof.
      await send(
        page,
        `What exact synthetic token appears on line ${SECRET_LINE} of ${DATA_FILE}? The file is deleted and the summary does not contain it — use the read_transcript tool with the id from your context, then answer with only the token. Do not guess or quote the padded line.`,
        240_000,
      );
      await expect(panel).toContainText(SECRET, { timeout: 15_000 });
      // Visible only: the collapsed summary body can also contain the phrase.
      await expect(
        panel
          .getByText("Earlier conversation")
          .filter({ visible: true })
          .first(),
        "read_transcript should appear as a tool call",
      ).toBeVisible({ timeout: 15_000 });

      // 5b. The preserved tail is usable, not decorative: a question about the
      //     last exchange is answerable from what is on screen, with no
      //     transcript lookup needed.
      await send(
        page,
        "Without using any tool: what exactly did I ask you to reply in my most recent message before this one?",
        120_000,
      );
      await expect(panel.getByText(/three/i).last()).toBeVisible({
        timeout: 15_000,
      });

      // 6. The way back is real — that is the whole point of forking.
      await panel.getByRole("button", { name: "Open the original chat" }).click();
      await expect(
        panel.getByText("Reply with just: one").first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByText("Conversation compacted")).toHaveCount(0);
    },
  );
});
