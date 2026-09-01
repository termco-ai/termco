import {
  APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
  type BootDiagnosticsCapability,
} from "@termco/application-base";
import {
  createProcessServiceProxy,
  processTransportService,
  type PluginModule,
  type ProcessTransport,
} from "@termco/kernel";

const plugin: PluginModule = {
  inject: [processTransportService],
  activate(context) {
    const transport = context.get<ProcessTransport>(processTransportService);
    context.provide(
      APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
      createProcessServiceProxy<BootDiagnosticsCapability>(
        APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
        transport,
      ),
    );
  },
};

export default plugin;
