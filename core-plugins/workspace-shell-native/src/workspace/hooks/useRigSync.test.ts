// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceCapability,
  WorkspaceEnv,
  WorkspaceRigsCapability,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRigSync } from "./useRigSync";
import { useRigPersistence } from "./useRigPersistence";
import { useRigsBoot } from "./useRigsBoot";

const rigsState = vi.hoisted(() => ({
  rigs: [] as { id: string; workspace: WorkspaceEnv }[],
}));

vi.mock("./useRigsBoot", () => ({ useRigsBoot: vi.fn() }));
vi.mock("./useRigPersistence", () => ({
  useRigPersistence: vi.fn(),
}));

const rigs = {
  snapshot: () => ({
    hydrated: true,
    rigs: rigsState.rigs,
    activeId: null,
  }),
} as unknown as WorkspaceRigsCapability;
const workspaceTabs = {} as WorkspaceTabsCapability;
const preferences = {} as PreferencesCapability;
const workspaceRegistry = {} as WorkspaceCapability;

vi.mock("../tabs", () => ({ DEFAULT_RIG_ID: "default" }));

const WSL: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };

function terminal(id: number, rigId: string): Tab {
  return {
    id,
    kind: "terminal",
    title: `t${id}`,
    rigId,
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  };
}

type Props = {
  activeRigId: string | null;
  rigsHydrated: boolean;
  activeId: number;
};

function setup(initial: Props, tabs: Tab[] = []) {
  const api = {
    allocId: vi.fn(() => 1),
    replaceTabs: vi.fn(),
    setSplit: vi.fn(),
    markBooted: vi.fn(),
    setActiveRigForNewTabs: vi.fn(),
    setActiveId: vi.fn(),
    activateRigTab: vi.fn(),
  };
  const adoptWorkspaceEnv = vi.fn(async () => "/home/u");
  const render = renderHook(
    (props: Props) =>
      useRigSync({
        ...api,
        tabs,
        activeId: props.activeId,
        splitTabId: 0,
        activeRigId: props.activeRigId,
        rigsHydrated: props.rigsHydrated,
        launchCwdResolved: true,
        launchCwd: "/launch",
        home: "/home/u",
        tabsRef: { current: tabs },
        adoptWorkspaceEnv,
        rigs,
        workspaceTabs,
        preferences,
        workspaceRegistry,
      }),
    { initialProps: initial },
  );
  return { ...render, ...api, adoptWorkspaceEnv };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  rigsState.rigs = [
    { id: "s1", workspace: { kind: "local" } },
    { id: "s2", workspace: WSL },
  ];
});

describe("boot and persistence wiring", () => {
  it("boots rigs with the launch context", () => {
    const s = setup({ activeRigId: "s1", rigsHydrated: true, activeId: 1 });
    expect(useRigsBoot).toHaveBeenCalledWith(
      expect.objectContaining({
        ready: true,
        launchCwd: "/launch",
        home: "/home/u",
        allocId: s.allocId,
        replaceTabs: s.replaceTabs,
        markBooted: s.markBooted,
        adoptWorkspaceEnv: s.adoptWorkspaceEnv,
        rigs,
        workspaceTabs,
        preferences,
        workspaceRegistry,
      }),
    );
  });

  it("enables persistence only after hydration, with a rig fallback", () => {
    setup({ activeRigId: null, rigsHydrated: false, activeId: 1 });
    expect(useRigPersistence).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRigId: "default",
        enabled: false,
        workspaceTabs,
      }),
    );
  });
});

describe("active-rig follow effect", () => {
  it("pins new tabs to the active rig without adopting on first render", () => {
    const s = setup({ activeRigId: "s1", rigsHydrated: true, activeId: 1 });
    expect(s.setActiveRigForNewTabs).toHaveBeenCalledWith("s1");
    expect(s.adoptWorkspaceEnv).not.toHaveBeenCalled();
    expect(s.activateRigTab).not.toHaveBeenCalled();
  });

  it("adopts the new rig's env and restores its last tab on switch", () => {
    const tabs = [terminal(1, "s1"), terminal(2, "s2"), terminal(3, "s2")];
    const s = setup(
      { activeRigId: "s1", rigsHydrated: true, activeId: 1 },
      tabs,
    );
    s.rerender({ activeRigId: "s2", rigsHydrated: true, activeId: 1 });
    expect(s.adoptWorkspaceEnv).toHaveBeenCalledWith(WSL);
    expect(s.activateRigTab).toHaveBeenCalledWith("s2", 3);
  });

  it("keeps the active tab when it already belongs to the new rig", () => {
    const tabs = [terminal(1, "s1"), terminal(2, "s2")];
    const s = setup(
      { activeRigId: "s1", rigsHydrated: true, activeId: 2 },
      tabs,
    );
    s.rerender({ activeRigId: "s2", rigsHydrated: true, activeId: 2 });
    expect(s.adoptWorkspaceEnv).toHaveBeenCalledWith(WSL);
    expect(s.activateRigTab).toHaveBeenCalledWith("s2", 2);
  });

  it("still restores the tab when the rig has no stored meta", () => {
    rigsState.rigs = [{ id: "s1", workspace: { kind: "local" } }];
    const tabs = [terminal(1, "s1"), terminal(2, "s2")];
    const s = setup(
      { activeRigId: "s1", rigsHydrated: true, activeId: 1 },
      tabs,
    );
    s.rerender({ activeRigId: "s2", rigsHydrated: true, activeId: 1 });
    expect(s.adoptWorkspaceEnv).not.toHaveBeenCalled();
    expect(s.activateRigTab).toHaveBeenCalledWith("s2", 2);
  });

  it("does not restore a tab when the rig has none", () => {
    const tabs = [terminal(1, "s1")];
    const s = setup(
      { activeRigId: "s1", rigsHydrated: true, activeId: 1 },
      tabs,
    );
    s.rerender({ activeRigId: "s2", rigsHydrated: true, activeId: 1 });
    expect(s.adoptWorkspaceEnv).toHaveBeenCalledWith(WSL);
    expect(s.activateRigTab).toHaveBeenCalledWith("s2");
  });

  it("stays idle before hydration", () => {
    const s = setup({
      activeRigId: "s1",
      rigsHydrated: false,
      activeId: 1,
    });
    s.rerender({ activeRigId: "s2", rigsHydrated: false, activeId: 1 });
    expect(s.setActiveRigForNewTabs).not.toHaveBeenCalled();
    expect(s.adoptWorkspaceEnv).not.toHaveBeenCalled();
    expect(s.activateRigTab).not.toHaveBeenCalled();
  });
});
