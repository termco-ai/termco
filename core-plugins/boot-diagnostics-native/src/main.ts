import type {
  BootDiagnostic,
  BootDiagnosticsCapability,
} from "@termco/application-base";
import type { PluginModule } from "@termco/kernel";
import type { StorageCapability } from "@termco/storage-base";
import { STORAGE_APPLICATION_SERVICE } from "@termco/storage-base";

const STORE_PATH = "termco-boot-diagnostics.json";
const DIAGNOSTIC_KEY = "lastProfileBootFailure";

const plugin: PluginModule = {
  inject: [STORAGE_APPLICATION_SERVICE],
  async activate(context) {
    const storage = context.get<StorageCapability>("storage.application");
    const store = await storage.open(STORE_PATH);
    await context.effect(() => () => storage.close(STORE_PATH));
    const capability: BootDiagnosticsCapability = {
      async read() {
        return store.get<BootDiagnostic>(DIAGNOSTIC_KEY) ?? null;
      },
      async record(diagnostic) {
        store.set(DIAGNOSTIC_KEY, diagnostic);
        await store.save();
      },
      async clear() {
        store.delete(DIAGNOSTIC_KEY);
        await store.save();
      },
    };
    context.provide("application.boot-diagnostics", capability);
  },
};

export default plugin;
