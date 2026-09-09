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
import { useRef, type HTMLAttributes } from "react";
import { usePaneDocking, type DockPane } from "../hooks/usePaneDocking";
import { PaneDockOverlay } from "./PaneDockOverlay";

/** The pane's tab population for the surface area — everything else the
 * stacks need comes from the selected `ui.tabs.kinds` contributions. The
 * bottom input bar renders from the ai plugin's workspace-footer slot. */
type SurfaceProps = SurfaceHostProps;

/** Split-view props: left/right identify the primary/secondary hosts even
 * when the user changes their physical order or orientation. */
type SplitProps = {
  presentation: UiTabPresentationCapability;
  splitTab: Tab | undefined;
  splitTabId: number;
  splitDirection?: "horizontal" | "vertical";
  splitPlacement?: "before" | "after";
  focusedPane: "left" | "right";
  onFocusPane: (pane: "left" | "right") => void;
  onDockPane?: DockPane;
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

/** One split pane: a draggable title and separate close button above its
 * surface, wrapped so interaction anywhere focuses the pane. */
function SplitPane({
  presentation,
  tab,
  focused,
  onFocus,
  onClose,
  closeLabel,
  showHeader = true,
  dragHandle,
  children,
}: {
  presentation: UiTabPresentationCapability;
  tab: Tab | undefined;
  focused: boolean;
  onFocus: () => void;
  onClose?: () => void;
  closeLabel?: string;
  showHeader?: boolean;
  dragHandle?: HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const Icon = presentation.Icon;
  return (
    <div
      onPointerDownCapture={showHeader ? onFocus : undefined}
      onFocusCapture={showHeader ? onFocus : undefined}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-sm ring-inset transition-shadow",
        showHeader && focused ? "ring-1 ring-primary/40" : "ring-0",
      )}
    >
      {showHeader && <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/40 px-2">
        <div {...dragHandle} data-pane-drag-handle title="Drag to move pane"
          className="flex h-full min-w-0 flex-1 touch-none cursor-grab select-none items-center gap-1.5 active:cursor-grabbing">
          {tab && Icon ? <Icon tab={tabPresentationModel(tab)} /> : null}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {tab?.title ?? ""}
          </span>
        </div>
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
      </div>}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The main workspace column: the pane surface (terminals / editors / previews
 * / diffs / git history). When a split tab is set, the surface area splits
 * into two resizable panes, either side by side or stacked.
 */
export function WorkspaceColumn({
  presentation,
  splitTab,
  splitTabId,
  splitDirection = "horizontal",
  splitPlacement = "after",
  focusedPane,
  onFocusPane,
  onDockPane,
  onClosePane,
  ...surface
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const docking = usePaneDocking(surfaceRef, onDockPane);
  const vertical = splitDirection === "vertical";
  const secondaryFirst = splitPlacement === "before";
  const firstLabel = vertical ? "Close top pane" : "Close left pane";
  const lastLabel = vertical ? "Close bottom pane" : "Close right pane";
  // Stable keys preserve live editor buffers while the panels change order.
  // The primary host also stays mounted when entering/leaving the split.
  const primary = (
    <ResizablePanel key="primary" id="ws-left" defaultSize={splitTab ? "50%" : "100%"} minSize="20%">
      <SplitPane
        presentation={presentation}
        tab={surface.activeTab}
        showHeader={Boolean(splitTab)}
        focused={focusedPane === "left"}
        onFocus={() => onFocusPane("left")}
        onClose={() => onClosePane("left")}
        closeLabel={secondaryFirst ? lastLabel : firstLabel}
        dragHandle={docking.handlers("left")}
      >
        <SurfaceHost {...surface} />
      </SplitPane>
    </ResizablePanel>
  );
  const secondary = splitTab ? (
    <ResizablePanel key="secondary" id="ws-right" defaultSize="50%" minSize={vertical ? "15%" : "20%"}>
      <SplitPane
        presentation={presentation}
        tab={splitTab}
        focused={focusedPane === "right"}
        onFocus={() => onFocusPane("right")}
        onClose={() => onClosePane("right")}
        closeLabel={secondaryFirst ? firstLabel : lastLabel}
        dragHandle={docking.handlers("right")}
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
  ) : null;
  const divider = splitTab ? <ResizableHandle key="divider" withHandle /> : null;
  const surfaceArea = (
    <ResizablePanelGroup orientation={splitDirection}>
      {secondaryFirst ? [secondary, divider, primary] : [primary, divider, secondary]}
    </ResizablePanelGroup>
  );

  return (
    <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={surfaceRef}
          {...{ [WORKSPACE_SURFACE_ATTR]: true }}
          className="relative min-h-0 flex-1"
        >
          {surfaceArea}
          {docking.target && <PaneDockOverlay target={docking.target} />}
        </div>
      </div>
    </ResizablePanel>
  );
}
