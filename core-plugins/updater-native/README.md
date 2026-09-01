# Software Updates

The complete default implementation of `application.updates` and the shared
renderer workflow `application.update-state`. Copy this folder to replace
update feeds, rollout policy, metadata handling, installation behavior, or the
exact updater dialog without creating a second progress store.

Full application releases continue through `electron-updater`. The same UI
also checks the separately signed plugin feed through kernel host control,
shows the complete atomic set, and activates a confirmed compatible set live.
