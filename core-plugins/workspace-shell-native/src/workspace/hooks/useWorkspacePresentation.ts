import { labelFor, type Tab } from "../tabs";
import type { UiHeaderFindTarget, UiHeaderTab } from "@termco/ui-header-base";
import type { WorkspaceEnv, WorkspacePresentationControlCapability } from "@termco/workspace-base";
import { useEffect } from "react";

function toHeaderTab(tab: Tab): UiHeaderTab {
  return {
    id: tab.id,
    rigId: tab.rigId,
    kind: tab.kind,
    label: labelFor(tab),
    title: tab.title,
    dirty: tab.kind === "editor" && tab.dirty,
    preview: tab.kind === "editor" && tab.preview,
    private: tab.kind === "terminal" && Boolean(tab.private),
    ...("path" in tab && typeof tab.path === "string"
      ? { path: tab.path }
      : {}),
    ...(tab.kind === "terminal" && typeof tab.cwd === "string"
      ? { cwd: tab.cwd }
      : {}),
    ...(tab.kind === "editor"
      ? { overrideLanguage: tab.overrideLanguage ?? null }
      : {}),
  };
}

type Params = {
  allTabs: Tab[];
  rigTabs: Tab[];
  activeTabId: number;
  agentsViewOpen: boolean;
  editorDirty: boolean;
  findTarget: UiHeaderFindTarget | null;
  rootPath: string | null;
  workspace: NonNullable<WorkspaceEnv>;
  activeFilePath: string | null;
  cwd: string | null;
  filePath: string | null;
  home: string | null;
  privateActive: boolean;
  zenMode: boolean;
};

/** Publish the workspace's derived UI read model through its selected shared
 * provider. No header or sidebar consumer imports workspace-private state. */
export function useWorkspacePresentation(
  params: Params,
  control: WorkspacePresentationControlCapability,
): void {
  useEffect(() => {
    control.publish({
      header: {
        tabs: params.rigTabs.map(toHeaderTab),
        allTabs: params.allTabs.map(toHeaderTab),
        activeTabId: params.activeTabId,
        agentsViewOpen: params.agentsViewOpen,
        editorDirty: params.editorDirty,
        findTarget: params.findTarget,
      },
      sidebar: {
        rootPath: params.rootPath,
        workspace: params.workspace,
        activeFilePath: params.activeFilePath,
      },
      context: {
        cwd: params.cwd,
        filePath: params.filePath,
        home: params.home,
        privateActive: params.privateActive,
        zenMode: params.zenMode,
      },
    });
  }, [control, params]);
}
