export function isUnhandledSettingsEscape(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented">,
): boolean {
  return event.key === "Escape" && !event.defaultPrevented;
}
