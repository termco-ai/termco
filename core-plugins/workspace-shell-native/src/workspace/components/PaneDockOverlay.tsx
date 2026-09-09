import { cn } from "@termco/ui";
import type { DockPosition, SnapTarget } from "@termco/ui-shell-base";

const regions: Record<DockPosition, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};
const labels: Record<DockPosition, string> = { left: "left", right: "right", top: "above", bottom: "below" };

/** The shell owns pane gestures and their feedback; the tab strip owns its
 * equivalent preview. Both use the public shell docking geometry. */
export function PaneDockOverlay({ target }: { target: NonNullable<SnapTarget> }) {
  const vertical = target === "top" || target === "bottom";
  const before = target === "left" || target === "top";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-50">
      {target !== "center" && (
        <div data-testid="pane-dock-drop-indicator" data-dock-position={target}
          className={cn("absolute rounded-md border-2 border-primary/60 bg-primary/10", regions[target])} />
      )}
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
        {target !== "center" && (
          <span className={cn("flex h-8 w-12 gap-0.5 rounded border border-current/30 p-0.5", vertical && "flex-col")}>
            <span className={cn("flex-1 rounded-[1px]", before ? "bg-primary/70" : "bg-muted-foreground/15")} />
            <span className={cn("flex-1 rounded-[1px]", before ? "bg-muted-foreground/15" : "bg-primary/70")} />
          </span>
        )}
        <span className="whitespace-nowrap text-xs font-medium">
          {target === "center" ? "Drag to an edge to move pane" : `Release to place ${labels[target]}`}
        </span>
      </div>
    </div>
  );
}
