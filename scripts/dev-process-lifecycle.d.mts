export interface DevChildProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}

export function childIsRunning(child: DevChildProcess | null | undefined): boolean;
export function stopDevProcesses(
  processes: Array<DevChildProcess | null | undefined>,
  timeoutMs?: number,
): Promise<void>;
export function stopDevStack(
  electron: DevChildProcess | null | undefined,
  supportingProcesses: Array<DevChildProcess | null | undefined>,
): Promise<void>;
