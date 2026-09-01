export const counterService = "company.counter" as const;

export interface CompanyCounter {
  current(): number;
  increment(by?: number): number;
}

declare module "@termco/kernel" {
  interface Services {
    [counterService]: CompanyCounter;
  }
}
