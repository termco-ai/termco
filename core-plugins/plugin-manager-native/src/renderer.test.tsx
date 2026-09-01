// @vitest-environment jsdom
import type {
  ApplicationPaths,
  ApplicationPathsCapability,
} from "@termco/application-base";
import type {
  DesktopIntegrationCapability,
} from "@termco/desktop-base";
import type {
  PluginCatalogItem,
} from "@termco/profile-base";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginManager, createProfileManager, managedPluginFolder } from "./renderer";
import type { ManagedPluginProfileApi } from "./profileServices";

afterEach(cleanup);

const catalog: readonly PluginCatalogItem[] = [];
const openPluginsFolder = vi.fn(async () => ({ path: "/managed/plugins" }));
const installFromFolder = vi.fn(async () => ({ status: "cancelled" as const }));
const profile = {
  catalog: () => catalog,
  subscribe: () => () => {},
  listDrafts: async () => [],
  openPluginsFolder,
  installFromFolder,
} as unknown as ManagedPluginProfileApi;

describe("Plugin Manager", () => {
  it("uses the current plugin-platform folder without a legacy v2 segment", () => {
    const folder = managedPluginFolder({
      appConfigDir: "/Users/example/Library/Application Support/termco/",
      pathSeparator: "/",
    } satisfies ApplicationPaths);

    expect(folder).toBe(
      "/Users/example/Library/Application Support/termco/plugin-platform/plugins",
    );
    expect(folder).not.toContain("/v2/");
  });

  it("always exposes the managed plugin folder, including before the first install", async () => {
    const desktop = {
      openPath: vi.fn(async () => {}),
    } as unknown as DesktopIntegrationCapability;
    const paths = {
      getPaths: vi.fn(async () => ({
        appConfigDir: "/Users/example/Library/Application Support/termco/",
        pathSeparator: "/",
      })),
    } satisfies ApplicationPathsCapability;
    const PluginManager = createPluginManager(profile, desktop, paths);

    render(<PluginManager />);

    expect(screen.getByTestId("installed-plugins")).toBeDefined();
    expect(screen.getByText("No plugins installed")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Open plugins folder" }),
    );

    await waitFor(() => {
      expect(openPluginsFolder).toHaveBeenCalledOnce();
    });
    expect(desktop.openPath).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Install from folder…" }));
    await waitFor(() => expect(installFromFolder).toHaveBeenCalledOnce());
  });
});

describe("Profiles Settings", () => {
  it("names and exports the active profile, imports packages, and activates an installed revision", async () => {
    const profileSnapshot = vi.fn(async () => ({
      activeProfileId: "termco.default",
      profiles: [
        {
          id: "termco.default",
          name: "Termco Default",
          description: "Shipped setup.",
          kind: "default" as const,
          active: true,
          pluginCount: 105,
          inactivePluginCount: 0,
          customPluginCount: 0,
        },
        {
          id: "imported.company.acme.1.0.0",
          name: "Acme Developer",
          description: "Company setup.",
          version: "1.0.0",
          kind: "imported" as const,
          active: false,
          pluginCount: 106,
          inactivePluginCount: 1,
          customPluginCount: 1,
        },
      ],
    }));
    const exportProfile = vi.fn(async () => ({
      status: "exported" as const,
      path: "/tmp/acme-1.0.0.termco-profile.zip",
      name: "Acme Developer",
      version: "1.0.0",
      pluginCount: 106,
      packagedPluginCount: 1,
    }));
    const importProfile = vi.fn(async () => ({
      status: "imported" as const,
      profileId: "imported.company.acme.1.0.0",
      name: "Acme Developer",
      version: "1.0.0",
      pluginCount: 106,
      packagedPluginCount: 1,
    }));
    const activate = vi.fn(async (profileId: string) => ({
      status: "replaced" as const,
      profileId,
    }));
    const ProfileManager = createProfileManager({
      profileSnapshot,
      exportProfile,
      importProfile,
      activate,
    } as unknown as ManagedPluginProfileApi);
    render(<ProfileManager />);
    await screen.findByText("Termco Default");

    const exportButton = screen.getByTestId("profile-export");
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("profile-export-name"), {
      target: { value: "Acme Developer" },
    });
    fireEvent.click(exportButton);
    await waitFor(() => expect(exportProfile).toHaveBeenCalledWith({
      name: "Acme Developer",
      description: "",
      version: "1.0.0",
    }));
    expect(await screen.findByText(/Exported Acme Developer 1.0.0/)).toBeDefined();

    fireEvent.click(screen.getByTestId("profile-import"));
    await waitFor(() => expect(importProfile).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Imported Acme Developer 1.0.0/)).toBeDefined();

    const imported = screen.getByTestId("profile-row-imported.company.acme.1.0.0");
    fireEvent.click(imported.getElementsByTagName("button")[0]!);
    await waitFor(() => expect(activate).toHaveBeenCalledWith("imported.company.acme.1.0.0"));
  });
});
