# Boot diagnostics ownership

- Keep persistence and diagnostic schema handling inside this provider.
- Consume durable storage only through `storage.application`.
- Never add recovery UI to the kernel; UI belongs to a consumer plugin.
- Keep error payloads actionable and free of secrets.
