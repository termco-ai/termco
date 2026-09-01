import type { ProcessHostControl } from "@termco/kernel";
import type {
  PluginCatalogItem,
  PluginCreateResult,
  PluginForkResult,
  PluginDisableImpact,
  PluginEnableConfirmation,
  PluginEnabledResult,
  PluginMutationResult,
  PluginAuthoringProfileApi,
  PluginUninstallResult,
  PluginUndoResult,
  ProfileExportRequest,
  ProfileExportResult,
  ProfileImportResult,
  ProfileManagementSnapshot,
  ProfileActivationResult,
} from "@termco/profile-base";

export type ManagedPluginCatalogItem = PluginCatalogItem & {
  profileRowId?: string;
  enabled?: boolean;
  essentialReason?: string;
  profileRelation?: "inherited" | "installed" | "fork" | "replacement";
  forkedFrom?: string;
};

interface PluginInstallResult {
  status: "installed" | "cancelled";
  pluginId?: string;
  sourceFolder?: string;
  warning?: { message: string };
}

export interface ManagedPluginProfileApi extends PluginAuthoringProfileApi {
  catalog(): readonly ManagedPluginCatalogItem[];
  installFromFolder(): Promise<PluginInstallResult>;
  openPluginsFolder(): Promise<{ path: string }>;
}

export interface ProfileServices {
  readonly profile: ManagedPluginProfileApi;
  readonly catalog: readonly ManagedPluginCatalogItem[];
  dispose(): void;
}

export function createProfileServices(
  hostControl: ProcessHostControl,
): ProfileServices {
  const catalog = [...hostControl.catalog()] as ManagedPluginCatalogItem[];
  let profileCatalog: readonly ManagedPluginCatalogItem[] = [...catalog];
  const listeners = new Set<() => void>();
  let disposed = false;
  const removeHostSubscription = hostControl.subscribe(() => {
    if (disposed) return;
    const replacement = hostControl.catalog() as readonly ManagedPluginCatalogItem[];
    catalog.splice(0, catalog.length, ...replacement);
    profileCatalog = [...catalog];
    for (const listener of listeners) listener();
  });
  const profile: ManagedPluginProfileApi = {
    catalog: () => profileCatalog,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listDrafts: async () =>
      (await hostControl.listPluginDrafts()) as import("@termco/profile-base").PluginDraftItem[],
    plan: async (request) =>
      (await hostControl.planPlugin(request)) as import("@termco/profile-base").PluginAuthoringPlanResult,
    listSourceFiles: (pluginId) => hostControl.listSourceFiles(pluginId),
    readSourceFile: (pluginId, relativePath) =>
      hostControl.readSourceFile(pluginId, relativePath),
    writeSourceFile: (pluginId, relativePath, content) =>
      hostControl.writeSourceFile(pluginId, relativePath, content),
    create: async (planId) =>
      (await hostControl.createPlugin(planId)) as PluginCreateResult,
    fork: async (planId) =>
      (await hostControl.forkPlugin(planId)) as PluginForkResult,
    copyAndReplace: async (planId) =>
      (await hostControl.copyAndReplace(planId)) as PluginMutationResult,
    apply: async (pluginId) =>
      (await hostControl.apply(pluginId)) as PluginMutationResult,
    undo: async (completionId) =>
      (await hostControl.undoPluginCompletion(completionId)) as PluginUndoResult,
    openPluginFolder: async (pluginId) =>
      (await hostControl.openPluginFolder(pluginId)) as { path: string },
    uninstall: async (pluginId) =>
      (await hostControl.uninstall(pluginId)) as PluginUninstallResult,
    previewSetEnabled: async (pluginId, enabled) =>
      (await hostControl.previewSetEnabled(pluginId, enabled)) as PluginDisableImpact,
    setEnabled: async (
      pluginId,
      enabled,
      confirmation: PluginEnableConfirmation,
    ) =>
      (await hostControl.setEnabled(
        pluginId,
        enabled,
        confirmation,
      )) as PluginEnabledResult,
    installFromFolder: async () =>
      (await hostControl.installFromFolder()) as PluginInstallResult,
    openPluginsFolder: async () =>
      (await hostControl.openPluginsFolder()) as { path: string },
    activate: async (profileId) =>
      (await hostControl.activateProfile(profileId)) as ProfileActivationResult,
    profileSnapshot: async () =>
      (await hostControl.profileSnapshot()) as ProfileManagementSnapshot,
    exportProfile: async (request: ProfileExportRequest) =>
      (await hostControl.exportProfile(request)) as ProfileExportResult,
    importProfile: async () =>
      (await hostControl.importProfile()) as ProfileImportResult,
  };

  return {
    profile,
    catalog,
    dispose() {
      if (disposed) return;
      disposed = true;
      removeHostSubscription();
      listeners.clear();
    },
  };
}
