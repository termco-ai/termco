export const ELECTRON_EXECUTABLE: string;
export function spawnElectronProcess<T>(
  spawn: (
    command: string,
    args: string[],
    options: import("node:child_process").SpawnOptions,
  ) => T,
  environment: NodeJS.ProcessEnv,
  url: string,
): T;
