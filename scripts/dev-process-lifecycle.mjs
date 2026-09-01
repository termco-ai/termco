/** True until a spawned child has actually emitted exit/close. */
export function childIsRunning(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

function exited(child) {
  if (!childIsRunning(child)) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

/**
 * Terminate dev children and wait for them before returning control to the
 * shell. This prevents Electron teardown logs from appearing after the prompt
 * and keeps intentional SIGTERM shutdowns from looking like pnpm failures.
 */
export async function stopDevProcesses(processes, timeoutMs = 5_000) {
  const running = processes.filter(childIsRunning);
  if (running.length === 0) return;
  const allExited = Promise.all(running.map(exited));
  for (const child of running) child.kill("SIGTERM");

  let timedOut = false;
  let timer;
  await Promise.race([
    allExited,
    new Promise((resolve) =>
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs),
    ),
  ]);
  clearTimeout(timer);
  if (!timedOut) return;
  for (const child of running) {
    if (childIsRunning(child)) child.kill("SIGKILL");
  }
  await Promise.all(running.map(exited));
}

/** Close Electron first so its renderer can release native terminal resources. */
export async function stopDevStack(electron, supportingProcesses) {
  await stopDevProcesses([electron], 10_000);
  await stopDevProcesses(supportingProcesses);
}
