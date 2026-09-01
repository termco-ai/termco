import type {
  CompanyCounter,
  counterService as CounterServiceToken,
} from "@company/counter-base";
import {
  createProcessServiceProxy,
  processTransportService,
  type PluginModule,
  type ProcessTransport,
} from "@termco/kernel";

const counterService: typeof CounterServiceToken = "company.counter";

/** Renderer calls are asynchronous even though the local counter fixture is
 * deliberately synchronous. A real cross-process base would publish this
 * promise-returning projection directly. */
export type RemoteCompanyCounter = {
  [Method in keyof CompanyCounter]: CompanyCounter[Method] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};

const plugin: PluginModule = {
  inject: [processTransportService],
  activate(context) {
    const transport = context.get<ProcessTransport>(processTransportService);
    const proxy = createProcessServiceProxy<RemoteCompanyCounter>(
      counterService,
      transport,
    );
    context.provide(counterService, proxy);
  },
};

export default plugin;
