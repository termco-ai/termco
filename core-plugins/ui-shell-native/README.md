# Application Shell

The default provider for `ui.shell`. It owns the renderer root, the exact global
notification host, and exposes the UI contributions resolved by the active
profile. Copy this whole directory, change its id, declare
`replaces: "ui-shell-native"`, and edit `src/` to ship a complete replacement
without modifying the platform.
