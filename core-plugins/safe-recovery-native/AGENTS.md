# Safe recovery UI ownership

- Keep all recovery presentation and interaction inside this folder.
- Read failures only through `application.boot-diagnostics`.
- Open the normal settings capability; never import Plugin Manager source.
- Preserve the exact error and failed profile id in the user-facing notice.
