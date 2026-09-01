import type { UiShellCapability } from "@termco/ui-shell-base";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ActiveRendererProfile } from "../../platform/rendererBootstrap";

export interface RendererRoot {
  render(children: ReactNode): void;
}

/** Render the selected shell owned by the settled renderer profile. */
export function renderRendererProfileRoot(
  root: RendererRoot,
  profile: ActiveRendererProfile | null,
): void {
  if (!profile) {
    // React roots schedule renders. Quiescence is a process-transaction
    // boundary, so commit the unmount before provider cleanup can begin and
    // before the candidate shell is published.
    flushSync(() => root.render(null));
    return;
  }
  const ShellRoot =
    profile.runtime.platformCapability<UiShellCapability>("ui.shell").Root;
  root.render(<ShellRoot />);
}
