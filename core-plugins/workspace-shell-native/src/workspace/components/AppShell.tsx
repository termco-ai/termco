import { ResizableHandle, ResizablePanelGroup } from "@termco/ui";
import type { ComponentProps } from "react";
import { AppOverlays } from "./AppOverlays";
import { SidebarPanel } from "./SidebarPanel";
import { WorkspaceColumn } from "./WorkspaceColumn";

type Props = {
  settingsViewOpen: boolean;
  agentsViewOpen: boolean;
  sidebar: ComponentProps<typeof SidebarPanel>;
  workspace: ComponentProps<typeof WorkspaceColumn>;
  overlays: ComponentProps<typeof AppOverlays>;
};

/**
 * The chrome layout: the resizable sidebar/workspace split and the floating
 * overlays. The header and status bar render from their plugins (CoreShell
 * slots), the AI dock/input bar from the ai plugin (dock/workspace-footer
 * slots), and the full-window settings/agents views from their plugins'
 * workspace-slot hosts (steps 8 + 9) — this shell only keeps the workspace
 * mounted (hidden) underneath while one of those views owns the body.
 */
export function AppShell({
  settingsViewOpen,
  agentsViewOpen,
  sidebar,
  workspace,
  overlays,
}: Props) {
  // Theme/TooltipProvider live in CoreShell (plugin-rewrite Phase 3 step 0).
  // `flex-1` (not the old h-screen): since the header moved to its own shell
  // slot, this shell fills the workspace slot's column instead of the window.
  return (
    <div className="termco-app relative flex min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <main className="zoom-content flex min-h-0 flex-1 flex-col">
        {/* The workspace stays mounted (hidden) under the agents/settings
            views (rendered by their plugins) so terminals, editors, and
            panel sizes survive the round trip. Wrapper div carries the hide:
            the panel group sets display via inline style, so a `hidden`
            class on it would lose. */}
        <div
          className={
            agentsViewOpen || settingsViewOpen
              ? "hidden"
              : "termco-workspace flex min-h-0 flex-1 flex-col"
          }
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            <SidebarPanel {...sidebar} />
            <ResizableHandle withHandle />
            <WorkspaceColumn {...workspace} />
          </ResizablePanelGroup>
        </div>
      </main>

      <AppOverlays {...overlays} />
    </div>
  );
}
