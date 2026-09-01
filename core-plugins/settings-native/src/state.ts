import type { UiSettingsViewCapability, UiSettingsViewSnapshot } from "@termco/ui-settings-base";

export function createSettingsViewState(): UiSettingsViewCapability {
  let snapshot: UiSettingsViewSnapshot = {
    revision: 0,
    open: false,
    requestedSection: null,
    openSequence: 0,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<UiSettingsViewSnapshot>) => {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show(sectionId) {
      publish({
        open: true,
        requestedSection: sectionId ?? null,
        openSequence: snapshot.openSequence + 1,
      });
    },
    close() {
      if (snapshot.open) publish({ open: false });
    },
    toggle(sectionId) {
      if (snapshot.open && !sectionId) publish({ open: false });
      else this.show(sectionId);
    },
  };
}
