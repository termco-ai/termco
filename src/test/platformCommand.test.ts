import { describe, expect, it } from "vitest";
import { commandInvocation } from "../../scripts/platform-command.mjs";
import { forwardedScriptArguments } from "../../scripts/script-arguments.mjs";
import { normalizeLineEndings } from "../../scripts/text-content.mjs";

describe("commandInvocation", () => {
  it("invokes Windows command scripts through cmd.exe without shell mode", () => {
    expect(
      commandInvocation("pnpm.cmd", ["install"], "win32", "C:\\cmd.exe"),
    ).toEqual({
      command: "C:\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", "install"],
    });
  });

  it("preserves native commands and arguments", () => {
    expect(commandInvocation("git", ["status"], "linux")).toEqual({
      command: "git",
      args: ["status"],
    });
  });
});

describe("forwardedScriptArguments", () => {
  it("removes pnpm's argument separator before forwarding Vitest options", () => {
    expect(forwardedScriptArguments(["--", "--shard=1/2"])).toEqual([
      "--shard=1/2",
    ]);
  });

  it("preserves arguments when pnpm does not include a separator", () => {
    expect(forwardedScriptArguments(["--shard=2/2"])).toEqual([
      "--shard=2/2",
    ]);
  });
});

describe("normalizeLineEndings", () => {
  it("makes generated-file checks independent of the checkout platform", () => {
    expect(normalizeLineEndings("first\r\nsecond\r\n")).toBe(
      "first\nsecond\n",
    );
    expect(normalizeLineEndings("first\nsecond\n")).toBe("first\nsecond\n");
  });
});
