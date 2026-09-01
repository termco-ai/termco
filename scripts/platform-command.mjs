export function commandInvocation(
  command,
  args,
  platform = process.platform,
  windowsShell = process.env.ComSpec || "cmd.exe",
) {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return {
      command: windowsShell,
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}
