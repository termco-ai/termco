import type { PluginModule } from "@termco/kernel";
// @ts-expect-error The external fixture resolves this declared file dependency during package compilation.
import type { CompanyCounter, counterService as CounterServiceToken } from "@company/counter-base";

const counterService: typeof CounterServiceToken = "company.counter";

export function createCompanyCounterConsumer(
  observe: (value: number) => void = () => {},
): PluginModule & { readonly inject: readonly string[] } {
  return {
    inject: [counterService],
    activate(context) {
      const counter = context.get<CompanyCounter>(counterService);
      observe(counter.increment());
    },
  };
}

export default createCompanyCounterConsumer();
