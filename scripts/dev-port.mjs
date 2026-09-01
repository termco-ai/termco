export function resolveDevPort(env = process.env) {
  const raw = env.TERMCO_VITE_PORT;
  if (raw === undefined || raw === "") return 1420;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TERMCO_VITE_PORT: ${raw}`);
  }
  return port;
}
