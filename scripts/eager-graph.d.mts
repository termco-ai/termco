export const DEFAULT_WATCH: readonly string[];

export interface EagerImportHit {
  spec: string;
  file: string;
}

export function traceEager(
  entry: string,
  watch?: readonly string[],
): {
  moduleCount: number;
  hits: Map<string, EagerImportHit>;
};
