import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const matrix = JSON.parse(readFileSync(
  join(root, "test/contracts/deterministic-flow-matrix.json"),
  "utf8",
)) as {
  schemaVersion: number;
  flows: Array<{
    id: string;
    keyless: boolean;
    evidence: string[];
    guards: string[];
  }>;
};

const required = [
  "chat-model-limits",
  "native-multi-step-tool",
  "auto-run-hard-approval",
  "mcp-managed-bridge",
  "file-mutation-world-state",
  "compaction-continuation",
  "crash-repair",
  "fork-rerun-lineage",
  "subagent-parent-child",
  "coding-agent-checkpoint",
  "blank-plugin-visible-fab",
  "plugin-disable-replace-provenance",
  "model-session-query-recall",
  "retry-cancel-hang",
  "reload-live-provider-replacement",
] as const;

describe("deterministic current-format flow matrix", () => {
  it("owns every required flow with keyless evidence and independent guards", () => {
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.flows.map((flow) => flow.id)).toEqual(required);
    for (const flow of matrix.flows) {
      expect(flow.keyless, flow.id).toBe(true);
      expect(flow.evidence.length, flow.id).toBeGreaterThan(0);
      expect(flow.guards.length, flow.id).toBeGreaterThanOrEqual(3);
      expect(flow.evidence.some((path) => /\.live\.spec\./.test(path)), flow.id)
        .toBe(false);
      for (const path of flow.evidence) {
        expect(existsSync(join(root, path)), `${flow.id}: ${path}`).toBe(true);
        expect(readFileSync(join(root, path), "utf8"), `${flow.id}: ${path}`)
          .toMatch(/\b(?:[A-Za-z_$][\w$]*Test|test|it)\s*\(/);
      }
    }
  });
});
