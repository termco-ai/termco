import type { ProcessHostControl } from "@termco/kernel";
import type { PluginCatalogItem } from "@termco/profile-base";
import { describe, expect, it, vi } from "vitest";
import { createProfileServices } from "./profileServices";

const catalogItem = (id: string): PluginCatalogItem => ({
  id,
  name: id,
  description: `${id} description`,
  category: "Company",
  version: "1.0.0",
  sourceFolder: `plugins/${id}`,
  sourceType: "package",
  editable: true,
  userInstalled: true,
  selectedBy: "company.profile",
  whyLoaded: "Selected by company.profile.",
  provides: [],
  consumes: [],
  permissions: [],
  processes: ["renderer"],
});

function createHostControl(
  values: Partial<ProcessHostControl> = {},
): ProcessHostControl {
  return {
    catalog: () => [catalogItem("company.clock")],
    subscribe: () => () => {},
    listPluginDrafts: async () => [],
    planPlugin: async (request) => ({
      ...(request as object),
      planId: "plan-1",
    }),
    listSourceFiles: async () => ["src/index.ts"],
    readSourceFile: async () => "source",
    writeSourceFile: async () => {},
    createPlugin: async (planId) => ({
      status: "draft",
      pluginId: planId,
      sourceFolder: `plugins/${planId}`,
    }),
    forkPlugin: async (planId) => ({
      status: "forked",
      pluginId: planId,
      sourceFolder: `plugins/${planId}`,
    }),
    copyAndReplace: async () => ({
      status: "replaced",
      pluginId: "company.clock.custom",
      sourceFolder: "plugins/company.clock.custom",
    }),
    apply: async (pluginId) => ({
      status: "replaced",
      pluginId,
      sourceFolder: `plugins/${pluginId}`,
    }),
    undoPluginCompletion: async (completionId) => ({
      status: "replaced",
      completionId,
      pluginId: "company.clock",
    }),
    uninstall: async (pluginId) => ({
      status: "uninstalled",
      pluginId,
      sourceFolder: `plugins/${pluginId}`,
      movedToTrash: true,
    }),
    previewSetEnabled: async (pluginId, enabled) => ({
      previewId: "preview-1",
      generation: 4,
      pluginId,
      enabled,
      blockedPlugins: [],
      unavailableFeatures: [],
      degradedPlugins: [],
      destructiveResources: [],
    }),
    setEnabled: async (pluginId, enabled, _confirmation) => ({
      status: "replaced",
      pluginId,
      enabled,
    }),
    installFromFolder: async () => ({ status: "cancelled" }),
    openPluginsFolder: async () => ({ path: "/managed/plugins" }),
    openPluginFolder: async (pluginId) => ({
      path: `/managed/plugins/${pluginId}`,
    }),
    activateProfile: async (profileId) => ({
      status: "replaced",
      profileId,
    }),
    profileSnapshot: async () => ({ activeProfileId: "termco.default", profiles: [] }),
    exportProfile: async () => ({ status: "cancelled" }),
    importProfile: async () => ({ status: "cancelled" }),
    ...values,
  };
}

describe("profile services", () => {
  it("maps every public profile operation to host control", async () => {
    const host = createHostControl({
      listPluginDrafts: vi.fn(async () => [{
        id: "company.clock.draft",
        name: "Clock draft",
        description: "Draft clock.",
        category: "Company",
        version: "1.0.0",
        sourceFolder: "/managed/plugins/company.clock.draft",
      }]),
      listSourceFiles: vi.fn(async () => ["src/main.ts"]),
      readSourceFile: vi.fn(async () => "export default 1;"),
      writeSourceFile: vi.fn(async () => {}),
      forkPlugin: vi.fn(async () => ({
        status: "forked",
        pluginId: "company.clock.fork",
        sourceFolder: "plugins/company.clock.fork",
      })),
      copyAndReplace: vi.fn(async () => ({
        status: "replaced",
        pluginId: "company.clock.custom",
        sourceFolder: "plugins/company.clock.custom",
      })),
      apply: vi.fn(async (pluginId: string) => ({
        status: "replaced",
        pluginId,
        sourceFolder: `plugins/${pluginId}`,
      })),
      uninstall: vi.fn(async (pluginId: string) => ({
        status: "uninstalled",
        pluginId,
        sourceFolder: `plugins/${pluginId}`,
        movedToTrash: true,
      })),
      previewSetEnabled: vi.fn(async (pluginId: string, enabled: boolean) => ({
        previewId: "preview-7",
        generation: 7,
        pluginId,
        enabled,
        blockedPlugins: [],
        unavailableFeatures: [],
        degradedPlugins: [],
        destructiveResources: [],
      })),
      setEnabled: vi.fn(async (pluginId: string, enabled: boolean) => ({
        status: "replaced",
        pluginId,
        enabled,
      })),
      installFromFolder: vi.fn(async () => ({ status: "cancelled" })),
      openPluginsFolder: vi.fn(async () => ({ path: "/managed/plugins" })),
      activateProfile: vi.fn(async (profileId: string) => ({
        status: "replaced",
        profileId,
      })),
      profileSnapshot: vi.fn(async () => ({
        activeProfileId: "termco.default",
        profiles: [],
      })),
      exportProfile: vi.fn(async () => ({ status: "cancelled" })),
      importProfile: vi.fn(async () => ({ status: "cancelled" })),
    });
    const services = createProfileServices(host);

    expect(services.profile.catalog()).toEqual(services.catalog);
    await expect(services.profile.listDrafts()).resolves.toEqual([
      expect.objectContaining({ id: "company.clock.draft" }),
    ]);
    await expect(services.profile.listSourceFiles("company.clock"))
      .resolves.toEqual(["src/main.ts"]);
    await expect(
      services.profile.readSourceFile("company.clock", "src/main.ts"),
    ).resolves.toBe("export default 1;");
    await services.profile.writeSourceFile(
      "company.clock",
      "src/main.ts",
      "next",
    );
    await expect(
      services.profile.fork("plan-fork"),
    ).resolves.toMatchObject({ pluginId: "company.clock.fork" });
    await expect(
      services.profile.copyAndReplace("plan-replace"),
    ).resolves.toMatchObject({ pluginId: "company.clock.custom" });
    await expect(services.profile.apply("company.clock")).resolves
      .toMatchObject({ pluginId: "company.clock" });
    await expect(services.profile.uninstall("company.clock")).resolves
      .toMatchObject({ movedToTrash: true });
    const preview = await services.profile.previewSetEnabled(
      "company.clock",
      false,
    );
    await expect(
      services.profile.setEnabled("company.clock", false, {
        previewId: preview.previewId,
        generation: preview.generation,
      }),
    ).resolves
      .toMatchObject({ pluginId: "company.clock", enabled: false });
    await expect(services.profile.installFromFolder()).resolves
      .toEqual({ status: "cancelled" });
    await expect(services.profile.openPluginsFolder()).resolves
      .toEqual({ path: "/managed/plugins" });
    await expect(services.profile.activate("termco.default")).resolves
      .toEqual({ status: "replaced", profileId: "termco.default" });
    await expect(services.profile.profileSnapshot()).resolves
      .toEqual({ activeProfileId: "termco.default", profiles: [] });
    await expect(services.profile.exportProfile({
      name: "Acme Developer",
      description: "Company setup.",
      version: "1.0.0",
    })).resolves.toEqual({ status: "cancelled" });
    await expect(services.profile.importProfile()).resolves
      .toEqual({ status: "cancelled" });

    expect(host.listSourceFiles).toHaveBeenCalledWith("company.clock");
    expect(host.listPluginDrafts).toHaveBeenCalledOnce();
    expect(host.readSourceFile).toHaveBeenCalledWith(
      "company.clock",
      "src/main.ts",
    );
    expect(host.writeSourceFile).toHaveBeenCalledWith(
      "company.clock",
      "src/main.ts",
      "next",
    );
    expect(host.activateProfile).toHaveBeenCalledWith("termco.default");
    expect(host.profileSnapshot).toHaveBeenCalledOnce();
    expect(host.exportProfile).toHaveBeenCalledWith({
      name: "Acme Developer",
      description: "Company setup.",
      version: "1.0.0",
    });
    expect(host.importProfile).toHaveBeenCalledOnce();
    expect(host.previewSetEnabled).toHaveBeenCalledWith("company.clock", false);
    expect(host.setEnabled).toHaveBeenCalledWith("company.clock", false, {
      previewId: "preview-7",
      generation: 7,
    });
    expect(host.installFromFolder).toHaveBeenCalledOnce();
    expect(host.openPluginsFolder).toHaveBeenCalledOnce();
  });

  it("updates the stable catalog in place and notifies profile subscribers", () => {
    let hostCatalog: readonly PluginCatalogItem[] = [catalogItem("first")];
    let publishHostCatalog = () => {};
    const host = createHostControl({
      catalog: () => hostCatalog,
      subscribe(listener) {
        publishHostCatalog = listener;
        return () => {};
      },
    });
    const services = createProfileServices(host);
    const stableCatalog = services.catalog;
    const firstProfileSnapshot = services.profile.catalog();
    const listener = vi.fn();
    services.profile.subscribe(listener);

    hostCatalog = [catalogItem("replacement"), catalogItem("consumer")];
    publishHostCatalog();

    expect(services.catalog).toBe(stableCatalog);
    expect(stableCatalog.map((plugin) => plugin.id)).toEqual([
      "replacement",
      "consumer",
    ]);
    expect(services.profile.catalog()).not.toBe(firstProfileSnapshot);
    expect(services.profile.catalog()).toEqual(stableCatalog);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("cleans up the host subscription exactly once", () => {
    let publishHostCatalog = () => {};
    const removeHostSubscription = vi.fn();
    const host = createHostControl({
      subscribe(listener) {
        publishHostCatalog = listener;
        return removeHostSubscription;
      },
    });
    const services = createProfileServices(host);
    const listener = vi.fn();
    services.profile.subscribe(listener);

    services.dispose();
    services.dispose();
    publishHostCatalog();

    expect(removeHostSubscription).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });
});
