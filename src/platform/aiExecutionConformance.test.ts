import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function productionSources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return /\.(?:ts|tsx)$/.test(entry.name) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) &&
        !path.includes(`${join("src", "baseline")}`)
      ? [path]
      : [];
  });
}

describe("current AI execution conformance", () => {
  it("has no application tool-body invocation outside the one executor", () => {
    const files = productionSources(join(root, "plugins"));
    const violations = files.flatMap((file) => {
      if (file === join(root, "plugin-repository/plugins/ai-registry-native/src/executor.ts")) {
        return [];
      }
      const source = readFileSync(file, "utf8");
      return /\bdefinition\.execute\(/.test(source)
        ? [relative(root, file)]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it("routes native Chat and MCP through ai.tool-execution", () => {
    const chat = readFileSync(
      join(root, "plugin-repository/plugins/ai-chat-native/src/chatRuntime.ts"),
      "utf8",
    );
    const mcp = readFileSync(
      join(root, "plugin-repository/plugins/mcp-tool-bridge/src/toolExecutor.ts"),
      "utf8",
    );
    expect(chat).toMatch(/selectedToolExecution\(\)\.executeStandalone/);
    expect(chat).toMatch(/execution\.execute\(/);
    expect(mcp).toMatch(/execution\.executeStandalone\(/);
    expect(mcp).not.toMatch(/definition\.execute\(/);
  });

  it("keeps external coding-agent records explicitly adapter-fidelity", () => {
    const journal = readFileSync(
      join(root, "plugin-repository/plugins/coding-agent-native/src/sessionJournal.ts"),
      "utf8",
    );
    expect(journal).toMatch(/fidelity:\s*"adapter"/);
    expect(journal).toMatch(/type:\s*"adapter\/event"/);
    expect(journal).toMatch(/type:\s*"workspace\/checkpoint"/);
    expect(journal).not.toMatch(/type:\s*"request\/header"/);
    expect(journal).not.toMatch(/type:\s*"tool\/(?:call|result)"/);
  });
});
