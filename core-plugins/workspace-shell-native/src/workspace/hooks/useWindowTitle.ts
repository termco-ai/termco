import type { Tab } from "../tabs";
import { findLeafCwd } from "../tabs/lib/panes";
import type { DesktopWindowCapability } from "@termco/desktop-base";
import { useEffect } from "react";

const APP_NAME = "Termco";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? (parts[parts.length - 1] as string) : "/";
}

/** Label of the focused tab — for terminals, the active pane's folder. */
function tabLabel(tab: Tab | undefined): string {
  if (!tab) return "";
  if (tab.kind === "terminal") {
    const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
    return cwd ? basename(cwd) : tab.title;
  }
  return tab.title;
}

/** Drives the native title through the selected desktop-window provider while
 * retaining the exact established project/tab title behavior. */
export function useWindowTitle(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
  desktopWindow: DesktopWindowCapability,
): void {
  const project = explorerRoot ? basename(explorerRoot) : "";
  const label = tabLabel(activeTab);

  useEffect(() => {
    let title: string;
    if (project && label && label !== project) title = `${project} — ${label}`;
    else title = project || label || APP_NAME;

    document.title = title;
    void desktopWindow.setTitle(title).catch(() => {});
  }, [desktopWindow, project, label]);
}
