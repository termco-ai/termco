import type {
  UiChangeRevealAdapter,
  UiChangeRevealRequest,
} from "@termco/ui-change-reveal-base";

const SHELL_MOUNTED_SERVICES = [
  "ui.header.items",
  "ui.statusbar.items",
  "ui.workspace.views",
  "ui.ai-dock.views",
  "ui.dock.surfaces",
  "ui.workspace.footer",
  "ui.overlays",
] as const;

function exactOwnedRoots(
  root: Document,
  request: UiChangeRevealRequest,
): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-plugin-owner]")].filter(
    (element) =>
      element.dataset.pluginOwner === request.target.pluginId &&
      element.dataset.pluginGeneration === request.target.generation &&
      element.dataset.contributionService === request.target.service &&
      element.dataset.contributionKey === request.target.key,
  );
}

/** Surface-owned locator for contributions mounted directly by the shell. */
export function createShellRevealAdapter(root: Document): UiChangeRevealAdapter {
  return {
    id: "ui-shell-mounted-contribution-reveal",
    services: SHELL_MOUNTED_SERVICES,
    async reveal(request) {
      const roots = exactOwnedRoots(root, request);
      const element = roots
        .flatMap((candidate) => [
          candidate,
          ...candidate.querySelectorAll<HTMLElement>(
            "button, [role], h1, h2, h3",
          ),
        ])
        .find((candidate) => candidate.getClientRects().length > 0) ?? roots[0];
      if (!element) {
        return {
          status: "not-found",
          target: request.target,
          message: "The exact owned shell contribution is no longer mounted.",
        };
      }
      return {
        status: "revealed",
        target: request.target,
        message: "The exact owned shell contribution was revealed.",
        element,
      };
    },
  };
}
