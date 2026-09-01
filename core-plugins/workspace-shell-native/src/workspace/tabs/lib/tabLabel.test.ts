import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { Tab, TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    rigId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/termco-ai" }))).toBe(
      "termco-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/termco-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });

  it("labels a segmentless cwd as the root", () => {
    expect(labelFor(terminalTab({ cwd: "/" }))).toBe("/");
  });
});

describe("labelFor (non-terminal tabs)", () => {
  it("uses the stored title for every non-terminal kind", () => {
    const base = { id: 1, rigId: "s" } as const;
    const tabs: Tab[] = [
      {
        ...base,
        kind: "editor",
        title: "foo.ts",
        path: "/a/foo.ts",
        dirty: false,
        preview: false,
      },
      { ...base, kind: "preview", title: "localhost", url: "http://x" },
      { ...base, kind: "markdown", title: "README.md", path: "/a/README.md" },
      {
        ...base,
        kind: "ai-diff",
        title: "foo.ts (AI diff)",
        path: "/a/foo.ts",
        originalContent: "",
        proposedContent: "",
        approvalId: "ap",
        status: "pending",
        isNewFile: false,
      },
      {
        ...base,
        kind: "git-diff",
        title: "foo.ts (+)",
        path: "a/foo.ts",
        repoRoot: "/r",
        mode: "+",
        originalPath: null,
      },
      { ...base, kind: "git-history", title: "Git History", repoRoot: "/r" },
      {
        ...base,
        kind: "git-commit-file",
        title: "foo.ts @ abc",
        repoRoot: "/r",
        sha: "abc123",
        shortSha: "abc",
        subject: "m",
        path: "a/foo.ts",
        originalPath: null,
      },
    ];
    for (const t of tabs) {
      expect(labelFor(t), t.kind).toBe(t.title);
    }
  });
});

