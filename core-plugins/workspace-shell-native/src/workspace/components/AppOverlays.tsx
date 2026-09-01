import type { Tab } from "../tabs";
import type { ComponentProps } from "react";
import { CloseDialogs } from "./CloseDialogs";

type Props = Omit<ComponentProps<typeof CloseDialogs>, "tabs"> & {
  tabs: Tab[];
};

/**
 * The workspace core's floating chrome: agent notification bridges, toasts,
 * the tab switcher HUD, and the close confirmation dialogs. The new-file
 * dialog is owned by the editor plugin. Every AI overlay (AgentRunBridge,
 * mini window, ask-from-selection
 * popup, MCP approval) renders from the ai plugin's overlays-slot
 * contribution now (plugin-rewrite Phase 3 step 9d).
 */
export function AppOverlays({
  tabs,
  ...closeDialogs
}: Props) {
  return (
    <>
      {/* The command palette renders from its plugin (overlays slot) —
          Phase 3 step 4. */}

      <CloseDialogs tabs={tabs} {...closeDialogs} />
    </>
  );
}

export type { Props as AppOverlaysProps };
