import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCommandCatalog } from "./commandCatalog";

const command = (id: string) => ({
  id,
  title: id,
  description: id,
  group: "Workspace",
  run: vi.fn(),
});

describe("workspace ui.commands catalogue", () => {
  it("publishes the mounted workspace's current commands and invalidates consumers", () => {
    const catalog = createWorkspaceCommandCatalog();
    const listener = vi.fn();
    catalog.contribution.subscribe?.(listener);

    const first = command("first");
    const dispose = catalog.install(() => [first]);
    expect(catalog.contribution.commands({} as never)).toEqual([first]);
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    expect(catalog.contribution.commands({} as never)).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not let an obsolete disposer remove a newer mounted workspace", () => {
    const catalog = createWorkspaceCommandCatalog();
    const disposeFirst = catalog.install(() => [command("first")]);
    const second = command("second");
    catalog.install(() => [second]);

    disposeFirst();
    expect(catalog.contribution.commands({} as never)).toEqual([second]);
  });
});
