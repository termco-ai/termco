import {
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  cn,
} from "@termco/ui";
import type { Tab } from "../tabs";
import { type UiHeaderTab } from "@termco/ui-header-base";
import { WORKSPACE_SURFACE_ATTR } from "@termco/ui-shell-base";
import { type UiTabPresentationCapability } from "@termco/ui-tabs-base";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SurfaceHost, type SurfaceHostProps } from "./SurfaceHost";

/** The pane's tab population for the surface area — everything else the
 * stacks need comes from the selected `ui.tabs.kinds` contributions. The
 * bottom input bar renders from the ai plugin's workspace-footer slot. */
type SurfaceProps = SurfaceHostProps;

/** Split-view props: when `splitTab` is set the column shows two surfaces side
 * by side (left = the primary surface, right = the split tab). */
type SplitProps = {
  presentation: UiTabPresentationCapability;
  splitTab: Tab | undefined;
  splitTabId: number;
  focusedPane: "left" | "right";
  onFocusPane: (pane: "left" | "right") => void;
  /** Collapse the split by removing one pane; the other tab stays open. */
  onClosePane: (pane: "left" | "right") => void;
};

type Props = SurfaceProps & SplitProps;

function tabPresentationModel(tab: Tab): UiHeaderTab {
  return {
    id: tab.id,
    rigId: tab.rigId,
    kind: tab.kind,
    title: tab.title,
    label: tab.title,
    dirty: tab.kind === "editor" && tab.dirty,
    preview: tab.kind === "editor" && tab.preview,
    private: tab.kind === "terminal" && Boolean(tab.private),
    ...("path" in tab && typeof tab.path === "string"
      ? { path: tab.path }
      : {}),
    ...(tab.kind === "editor"
      ? { overrideLanguage: tab.overrideLanguage ?? null }
      : {}),
  };
}

/** One split pane: a matching header (icon + title, so both panes look the
 * same) above its surface, wrapped so a click anywhere focuses it. The
 * secondary pane passes `onClose` to get the "close split" ×. */
function SplitPane({
  presentation,
  tab,
  focused,
  onFocus,
  onClose,
  closeLabel,
  children,
}: {
  presentation: UiTabPresentationCapability;
  tab: Tab | undefined;
  focused: boolean;
  onFocus: () => void;
  onClose?: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}) {
  const Icon = presentation.Icon;
  return (
    <div
      onPointerDownCapture={onFocus}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-sm ring-inset transition-shadow",
        focused ? "ring-1 ring-primary/40" : "ring-0",
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/40 px-2">
        {tab && Icon ? <Icon tab={tabPresentationModel(tab)} /> : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {tab?.title ?? ""}
        </span>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={closeLabel ?? "Close split"}
            aria-label={closeLabel ?? "Close split"}
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The main workspace column: the pane surface (terminals / editors / previews
 * / diffs / git history). When a split tab is set, the surface area splits
 * into two resizable panes side by side.
 */
export function WorkspaceColumn({
  presentation,
  splitTab,
  splitTabId,
  focusedPane,
  onFocusPane,
  onClosePane,
  ...surface
}: Props) {
  const surfaceArea = splitTab ? (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel id="ws-left" defaultSize="50%" minSize="20%">
        <SplitPane
          presentation={presentation}
          tab={surface.activeTab}
          focused={focusedPane === "left"}
          onFocus={() => onFocusPane("left")}
          onClose={() => onClosePane("left")}
          closeLabel="Close left pane"
        >
          <SurfaceHost {...surface} />
        </SplitPane>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="ws-right" defaultSize="50%" minSize="20%">
        <SplitPane
          presentation={presentation}
          tab={splitTab}
          focused={focusedPane === "right"}
          onFocus={() => onFocusPane("right")}
          onClose={() => onClosePane("right")}
          closeLabel="Close right pane"
        >
          <SurfaceHost
            tabs={[splitTab]}
            activeId={splitTabId}
            activeTab={splitTab}
            contributions={surface.contributions}
            createRuntime={surface.createRuntime}
          />
        </SplitPane>
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : (
    <SurfaceHost {...surface} />
  );

  return (
    <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
      <div className="flex h-full min-h-0 flex-col">
        <div
          {...{ [WORKSPACE_SURFACE_ATTR]: true }}
          className="relative min-h-0 flex-1"
        >
          {surfaceArea}
        </div>
      </div>
    </ResizablePanel>
  );
}
