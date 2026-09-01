// @vitest-environment jsdom
import {
  APPLICATION_PATHS_SERVICE,
  type ApplicationPathsCapability,
} from "@termco/application-base";
import {
  DESKTOP_INTEGRATION_SERVICE,
  type DesktopIntegrationCapability,
} from "@termco/desktop-base";
import {
  type ProcessHostControl,
  type ProcessTransport,
  processTransportService,
} from "@termco/kernel";
import {
  PLUGIN_CATALOG_SERVICE,
  PROFILE_CATALOG_SERVICE,
  PROFILE_TRANSACTIONS_SERVICE,
  type PluginCatalogItem,
  type PluginProfileApi,
} from "@termco/profile-base";
import {
  UI_SETTINGS_SECTIONS_SERVICE,
  UI_SETTINGS_VIEW_SERVICE,
  type UiSettingsSectionRegistry,
  type UiSettingsViewCapability,
} from "@termco/ui-settings-base";
import { describe, expect, it, vi } from "vitest";
import plugin from "./renderer";

const catalogItem: PluginCatalogItem = {
  id: "company.clock",
  name: "Company Clock",
  description: "Company clock provider.",
  category: "Company",
  version: "1.0.0",
  sourceFolder: "plugins/company.clock",
  sourceType: "package",
  editable: true,
  userInstalled: true,
  selectedBy: "company.profile",
  whyLoaded: "Selected by company.profile.",
  provides: [],
  consumes: [],
  permissions: [],
  processes: ["renderer"],
};

function hostControl(values: Partial<ProcessHostControl> = {}) {
  return {
    catalog: () => [catalogItem],
    subscribe: () => () => {},
    listPluginDrafts: async () => [],
    planPlugin: async (request) => ({
      ...(request as object),
      planId: "plan-1",
    }),
    listSourceFiles: async () => [],
    readSourceFile: async () => "",
    writeSourceFile: async () => {},
    createPlugin: async () => ({}),
    forkPlugin: async () => ({}),
    copyAndReplace: async () => ({}),
    apply: async () => ({}),
    undoPluginCompletion: async () => ({}),
    uninstall: async () => ({}),
    previewSetEnabled: async () => ({}),
    setEnabled: async () => ({}),
    installFromFolder: async () => ({}),
    openPluginsFolder: async () => ({}),
    openPluginFolder: async () => ({}),
    activateProfile: async () => ({}),
    profileSnapshot: async () => ({ activeProfileId: "termco.default", profiles: [] }),
    exportProfile: async () => ({ status: "cancelled" }),
    importProfile: async () => ({ status: "cancelled" }),
    ...values,
  } satisfies ProcessHostControl;
}

describe("Plugin Manager profile provider", () => {
  it("provides all profile-family services before registering its UI", async () => {
    const events: string[] = [];
    const provided = new Map<string, unknown>();
    const disposers: Array<() => void | Promise<void>> = [];
    const registry = {
      register: vi.fn(() => {
        events.push("register:ui.settings.sections");
        return () => {};
      }),
      snapshot: () => [],
      records: () => [],
      subscribe: () => () => {},
    } satisfies UiSettingsSectionRegistry;
    const desktop = {
      openPath: async () => {},
    } as unknown as DesktopIntegrationCapability;
    const paths = {
      getPaths: async () => ({
        appConfigDir: "/tmp/termco",
        pathSeparator: "/",
      }),
    } satisfies ApplicationPathsCapability;
    const transport = {
      hostControl: hostControl(),
    } as ProcessTransport;
    const settingsView = {
      snapshot: () => ({
        revision: 0,
        open: false,
        requestedSection: null,
        requestToken: 0,
        openSequence: 0,
      }),
      subscribe: () => () => {},
      show: () => {},
      close: () => {},
      toggle: () => {},
    } satisfies UiSettingsViewCapability;

    await plugin.activate({
      get(service: string) {
        if (service === processTransportService) return transport;
        if (service === UI_SETTINGS_SECTIONS_SERVICE) return registry;
        if (service === DESKTOP_INTEGRATION_SERVICE) return desktop;
        if (service === APPLICATION_PATHS_SERVICE) return paths;
        if (service === UI_SETTINGS_VIEW_SERVICE) return settingsView;
        throw new Error(`unexpected service get: ${service}`);
      },
      provide(service: string, value: unknown) {
        events.push(`provide:${service}`);
        provided.set(service, value);
        return () => provided.delete(service);
      },
      async effect(install: () => () => void | Promise<void>) {
        const dispose = await install();
        disposers.push(dispose);
        return dispose;
      },
      feature: () => () => {},
    } as never);

    expect(plugin.inject).toContain(processTransportService);
    expect(plugin.inject).not.toContain(PROFILE_CATALOG_SERVICE);
    expect(plugin.inject).not.toContain(PROFILE_TRANSACTIONS_SERVICE);
    expect(plugin.inject).not.toContain(PLUGIN_CATALOG_SERVICE);
    const catalogApi = provided.get(
      PROFILE_CATALOG_SERVICE,
    ) as PluginProfileApi;
    expect(provided.get(PROFILE_TRANSACTIONS_SERVICE)).toBe(catalogApi);
    expect(provided.get(PLUGIN_CATALOG_SERVICE)).toEqual([catalogItem]);
    expect(catalogApi.catalog()).toEqual([catalogItem]);
    const registrationIndex = events.indexOf("register:ui.settings.sections");
    for (const service of [
      PROFILE_CATALOG_SERVICE,
      PROFILE_TRANSACTIONS_SERVICE,
      PLUGIN_CATALOG_SERVICE,
    ]) {
      expect(events.indexOf(`provide:${service}`)).toBeLessThan(
        registrationIndex,
      );
    }
    expect(disposers).toHaveLength(3);
  });

  it("fails without host control instead of reading a profile fallback", async () => {
    const gets: string[] = [];
    const legacyProfile = {} as PluginProfileApi;
    const provide = vi.fn();
    const effect = vi.fn();

    await expect(
      plugin.activate({
        get(service: string) {
          gets.push(service);
          if (service === processTransportService) return {} as ProcessTransport;
          if (service === PROFILE_TRANSACTIONS_SERVICE) return legacyProfile;
          throw new Error(`unexpected service get: ${service}`);
        },
        provide,
        effect,
      } as never),
    ).rejects.toThrow(
      "plugin-manager-native requires ProcessTransport.hostControl to provide profile services",
    );

    expect(gets).toEqual([processTransportService]);
    expect(provide).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });
});
