/**
 * Confirmation dialogs for closing tabs: the generic kind-close prompt (payload
 * from the TabKindRegistry's `canClose` verdicts), plus the deleted-file, bulk
 * and app-close prompts. Thin composition over the individual prompts in
 * `./CloseDialogPrompts`.
 */
import type { Tab } from "../tabs";
import type { PendingWorkspaceTabClose } from "@termco/workspace-base";
import {
  AppCloseDialog,
  BulkCloseDialog,
  DeletedTabsDialog,
  KindCloseDialog,
} from "./CloseDialogPrompts";

type Props = {
  tabs: Tab[];
  pendingKindClose: PendingWorkspaceTabClose | null;
  onCancelKindClose: () => void;
  onConfirmKindClose: () => void;
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
  pendingBulkClose: number[] | null;
  onCancelBulkClose: () => void;
  onConfirmBulkClose: () => void;
  pendingAppClose: boolean;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
};

/** Confirmation dialogs for closing guarded tabs (kind prompts, deleted files,
 * bulk close) and quitting the app. */
export function CloseDialogs({
  tabs,
  pendingKindClose,
  onCancelKindClose,
  onConfirmKindClose,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
  pendingBulkClose,
  onCancelBulkClose,
  onConfirmBulkClose,
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
}: Props) {
  return (
    <>
      <KindCloseDialog
        pendingKindClose={pendingKindClose}
        onCancelKindClose={onCancelKindClose}
        onConfirmKindClose={onConfirmKindClose}
      />
      <DeletedTabsDialog
        tabs={tabs}
        pendingDeleteTabs={pendingDeleteTabs}
        onCancelDeleteClose={onCancelDeleteClose}
        onConfirmDeleteClose={onConfirmDeleteClose}
      />
      <BulkCloseDialog
        pendingBulkClose={pendingBulkClose}
        onCancelBulkClose={onCancelBulkClose}
        onConfirmBulkClose={onConfirmBulkClose}
      />
      <AppCloseDialog
        pendingAppClose={pendingAppClose}
        onCancelAppClose={onCancelAppClose}
        onConfirmAppClose={onConfirmAppClose}
      />
    </>
  );
}
