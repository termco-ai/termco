# Update provider ownership

- This folder owns update checks, downloads, installation, metadata mapping, and progress lifecycle.
- Publish one `application.update-state` store for every renderer surface; do
  not create private hook state per dialog or settings section.
- Publish progress through `events.application`; do not import application windows.
- Keep development or unconfigured-feed failures non-fatal.
