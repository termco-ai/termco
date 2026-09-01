import type { UiCommandItem, UiCommandSourceContribution } from "@termco/ui-commands-base";

type CommandBuilder = () => readonly UiCommandItem[];

export type WorkspaceCommandCatalog = {
  contribution: UiCommandSourceContribution;
  install(builder: CommandBuilder): () => void;
};

/** Keep the public contribution stable while the mounted workspace supplies
 * its render-dependent actions and disabled states. */
export function createWorkspaceCommandCatalog(): WorkspaceCommandCatalog {
  let current: CommandBuilder | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    contribution: {
      id: "workspace",
      order: 0,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      commands: () => current?.() ?? [],
    },
    install(builder) {
      current = builder;
      notify();
      return () => {
        if (current !== builder) return;
        current = null;
        notify();
      };
    },
  };
}
