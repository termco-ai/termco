// @vitest-environment jsdom
import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceCapability,
  WorkspaceRigsCapability,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRigsBoot, type RigsBootParams } from "../lib/runRigsBoot";
import { useRigsBoot } from "./useRigsBoot";

vi.mock("../lib/runRigsBoot", () => ({
  runRigsBoot: vi.fn(async () => {}),
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function params(ready: boolean): RigsBootParams {
  return {
    ready,
    launchCwd: "/launch",
    home: "/home/u",
    allocId: () => 1,
    replaceTabs: () => {},
    setSplit: () => {},
    markBooted: () => {},
    setActiveRigForNewTabs: () => {},
    adoptWorkspaceEnv: async () => null,
    rigs: {} as WorkspaceRigsCapability,
    workspaceTabs: {} as WorkspaceTabsCapability,
    preferences: {} as PreferencesCapability,
    workspaceRegistry: {} as WorkspaceCapability,
  };
}

describe("useRigsBoot", () => {
  it("does nothing until ready", () => {
    renderHook((value: RigsBootParams) => useRigsBoot(value), {
      initialProps: params(false),
    });
    expect(runRigsBoot).not.toHaveBeenCalled();
  });

  it("runs exactly once when ready flips true", () => {
    const { rerender } = renderHook(
      (value: RigsBootParams) => useRigsBoot(value),
      { initialProps: params(false) },
    );
    rerender(params(true));
    expect(runRigsBoot).toHaveBeenCalledOnce();
    rerender(params(true));
    rerender(params(false));
    rerender(params(true));
    expect(runRigsBoot).toHaveBeenCalledOnce();
  });

  it("passes the capability dependencies through", () => {
    const value = params(true);
    renderHook(() => useRigsBoot(value));
    expect(runRigsBoot).toHaveBeenCalledWith(value);
  });
});
