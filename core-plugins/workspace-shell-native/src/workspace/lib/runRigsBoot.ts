import type { Tab } from "../tabs";
import { DEFAULT_RIG_ID } from "../tabs";
import { isLeaf, type PaneNode } from "../tabs/lib/panes";
import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceCapability,
  WorkspaceEnv,
  WorkspaceRig,
  WorkspaceRigsCapability,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import { freshTerminalTab, hydrateTabs } from "./rigSerialization";

export type RigsBootParams = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  setSplit: (tabId: number) => void;
  markBooted: () => void;
  setActiveRigForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
  rigs: WorkspaceRigsCapability;
  workspaceTabs: WorkspaceTabsCapability;
  preferences: PreferencesCapability;
  workspaceRegistry: WorkspaceCapability;
};

function parseSshTarget(spec: string): {
  host: string;
  user?: string;
  port?: number;
} {
  let rest = spec;
  let user: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    user = rest.slice(0, at) || undefined;
    rest = rest.slice(at + 1);
  }
  let port: number | undefined;
  const colon = rest.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(rest.slice(colon + 1))) {
    port = Number(rest.slice(colon + 1));
    rest = rest.slice(0, colon);
  }
  return { host: rest, ...(user ? { user } : {}), ...(port ? { port } : {}) };
}

function parseWorkspace(key: string): NonNullable<WorkspaceEnv> {
  if (key.startsWith("wsl:")) {
    return { kind: "wsl", distro: key.slice("wsl:".length) };
  }
  if (key.startsWith("ssh:")) {
    const connectionId = key.slice("ssh:".length);
    return { kind: "ssh", connectionId, ...parseSshTarget(connectionId) };
  }
  return { kind: "local" };
}

function workspaceKey(workspace: WorkspaceEnv): string {
  if (workspace?.kind === "wsl") return `wsl:${workspace.distro}`;
  if (workspace?.kind === "ssh") return `ssh:${workspace.connectionId}`;
  return "local";
}

function uniqueCwds(tabs: readonly Tab[]): string[] {
  const paths = new Set<string>();
  const visit = (node: PaneNode) => {
    if (isLeaf(node)) {
      if (node.cwd) paths.add(node.cwd);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const tab of tabs) {
    if (tab.kind === "terminal") visit(tab.paneTree);
  }
  return [...paths];
}

export function findActiveRig(
  rigs: readonly WorkspaceRig[],
  activeId: string | null,
): WorkspaceRig | null {
  return rigs.find((rig) => rig.id === activeId) ?? rigs[0] ?? null;
}

export function activeRigEnv(
  rigs: readonly WorkspaceRig[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveRig(rigs, activeId)?.workspace ?? { kind: "local" };
}

export function freshTabCwd(
  workspace: WorkspaceEnv,
  restoredHome: string | null,
  launchCwd: string | null,
  home: string | null,
): string | null {
  return (
    restoredHome ??
    (workspace?.kind === "local" ? (launchCwd ?? home) : null)
  );
}

export async function runRigsBoot({
  launchCwd,
  home,
  allocId,
  replaceTabs,
  setSplit,
  markBooted,
  setActiveRigForNewTabs,
  adoptWorkspaceEnv,
  rigs,
  workspaceTabs,
  preferences,
  workspaceRegistry,
}: RigsBootParams): Promise<void> {
  try {
    const rigsSnapshot = rigs.snapshot();
    const rigList = rigsSnapshot.rigs;
    const layouts = new Map(
      workspaceTabs.savedLayouts().map((layout) => [layout.rigId, layout]),
    );

    if (rigList.length === 0) {
      const root = launchCwd ?? home ?? null;
      const savedWorkspace =
        (await preferences.get<string>("defaultWorkspaceEnv").catch(() => null)) ??
        "local";
      rigs.create({
        id: DEFAULT_RIG_ID,
        name: "Default",
        root,
        workspace: parseWorkspace(savedWorkspace),
      });
      setActiveRigForNewTabs(DEFAULT_RIG_ID);
      return;
    }

    const restored: Tab[] = [];
    for (const rig of rigList) {
      const layout = layouts.get(rig.id);
      if (layout) restored.push(...hydrateTabs(layout.tabs, rig.id, allocId));
    }

    const activeRigId =
      rigsSnapshot.activeId &&
      rigList.some((rig) => rig.id === rigsSnapshot.activeId)
        ? rigsSnapshot.activeId
        : rigList[0].id;
    setActiveRigForNewTabs(activeRigId);

    const activeWorkspace = activeRigEnv(rigList, activeRigId);
    const restoredHome = await adoptWorkspaceEnv(activeWorkspace);
    if (!restored.some((tab) => tab.rigId === activeRigId)) {
      restored.push(
        freshTerminalTab(
          activeRigId,
          freshTabCwd(activeWorkspace, restoredHome, launchCwd, home),
          allocId,
        ),
      );
    }

    const authorizationKeys = new Set<string>();
    const authorizationJobs: Promise<unknown>[] = [];
    for (const rig of rigList) {
      const rigTabs = restored.filter((tab) => tab.rigId === rig.id);
      for (const cwd of uniqueCwds(rigTabs)) {
        const key = `${workspaceKey(rig.workspace)}\0${cwd}`;
        if (authorizationKeys.has(key)) continue;
        authorizationKeys.add(key);
        authorizationJobs.push(
          Promise.resolve().then(() =>
            workspaceRegistry.authorize(cwd, rig.workspace),
          ),
        );
      }
    }
    await Promise.allSettled(authorizationJobs);

    const activeTabs = restored.filter((tab) => tab.rigId === activeRigId);
    const activeIndex = layouts.get(activeRigId)?.activeTabIndex ?? 0;
    const activeTab = activeTabs[activeIndex] ?? activeTabs[0] ?? restored[0];
    replaceTabs(restored, activeTab.id);

    const splitIndex = layouts.get(activeRigId)?.splitTabIndex ?? -1;
    const splitTab = splitIndex >= 0 ? activeTabs[splitIndex] : undefined;
    if (splitTab && splitTab.id !== activeTab.id) setSplit(splitTab.id);
  } catch (error) {
    console.error("[termco] rigs boot failed:", error);
  } finally {
    markBooted();
  }
}
