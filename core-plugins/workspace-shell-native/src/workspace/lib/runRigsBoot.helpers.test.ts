import type { WorkspaceEnv, WorkspaceRig } from "@termco/workspace-base";
import { describe, expect, it } from "vitest";
import { activeRigEnv, findActiveRig, freshTabCwd } from "./runRigsBoot";

function rig(over: Partial<WorkspaceRig>): WorkspaceRig {
  return {
    id: "s1",
    name: "Rig",
    root: null,
    workspace: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("findActiveRig", () => {
  it("returns the matching rig", () => {
    const rigs = [rig({ id: "a" }), rig({ id: "b" })];
    expect(findActiveRig(rigs, "b")?.id).toBe("b");
  });

  it("falls back to the first rig for a missing selection", () => {
    const rigs = [rig({ id: "a" }), rig({ id: "b" })];
    expect(findActiveRig(rigs, null)?.id).toBe("a");
    expect(findActiveRig(rigs, "missing")?.id).toBe("a");
  });

  it("returns null without rigs", () => {
    expect(findActiveRig([], "a")).toBeNull();
  });
});

describe("activeRigEnv", () => {
  it("restores the selected or fallback rig environment", () => {
    const rigs = [
      rig({ id: "a", workspace: { kind: "local" } }),
      rig({ id: "b", workspace: { kind: "wsl", distro: "Ubuntu" } }),
    ];
    expect(activeRigEnv(rigs, "b")).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(activeRigEnv(rigs, null)).toEqual({ kind: "local" });
    expect(activeRigEnv([], "a")).toEqual({ kind: "local" });
  });
});

describe("freshTabCwd", () => {
  const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  const local: WorkspaceEnv = { kind: "local" };

  it("prefers a restored home", () => {
    expect(freshTabCwd(wsl, "/home/aj", "C:/Users/me", "C:/Users/me")).toBe(
      "/home/aj",
    );
  });

  it("does not leak a local cwd into WSL", () => {
    expect(freshTabCwd(wsl, null, "C:/Users/me", "C:/Users/me")).toBeNull();
  });

  it("falls back through local launch cwd and home", () => {
    expect(freshTabCwd(local, null, "C:/work", "C:/Users/me")).toBe(
      "C:/work",
    );
    expect(freshTabCwd(local, null, null, "C:/Users/me")).toBe("C:/Users/me");
    expect(freshTabCwd(local, null, null, null)).toBeNull();
  });
});
