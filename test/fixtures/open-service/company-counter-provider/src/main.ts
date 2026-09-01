import type { PluginModule } from "@termco/kernel";
// @ts-expect-error The external fixture resolves this declared file dependency during package compilation.
import type { CompanyCounter, counterService as CounterServiceToken } from "@company/counter-base";

const counterService: typeof CounterServiceToken = "company.counter";

export function createCompanyCounterProvider(initialValue = 0): PluginModule {
  return {
    activate(context) {
      let value = initialValue;
      const counter: CompanyCounter = {
        current: () => value,
        increment(by = 1) {
          value += by;
          return value;
        },
      };
      context.provide(counterService, counter);
    },
  };
}

export default createCompanyCounterProvider();
