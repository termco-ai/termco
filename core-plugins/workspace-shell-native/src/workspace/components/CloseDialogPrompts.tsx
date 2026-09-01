/**
 * Individual confirmation dialogs used by {@link CloseDialogs}.
 *
 * Each dialog is extracted verbatim from the former single `CloseDialogs`
 * component so the container stays a thin composition of independent prompts.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@termco/ui";
import type { Tab } from "../tabs";
import type { PendingWorkspaceTabClose } from "@termco/workspace-base";

/**
 * Prompt shown when a tab-kind's registry `canClose` guard asked for
 * confirmation (dirty editor, terminal with a live process, ...). Renders the
 * verdict's prompt payload — the copy is owned by the contributing plugin.
 */
export function KindCloseDialog({
  pendingKindClose,
  onCancelKindClose,
  onConfirmKindClose,
}: {
  pendingKindClose: PendingWorkspaceTabClose | null;
  onCancelKindClose: () => void;
  onConfirmKindClose: () => void;
}) {
  return (
    <AlertDialog
      open={pendingKindClose !== null}
      onOpenChange={(open) => !open && onCancelKindClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingKindClose?.prompt.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingKindClose?.prompt.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelKindClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmKindClose}>
            {pendingKindClose?.prompt.confirmLabel ?? "Close Anyway"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Prompt shown when tabs for deleted files still hold unsaved changes. */
export function DeletedTabsDialog({
  tabs,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
}: {
  tabs: Tab[];
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
}) {
  return (
    <AlertDialog
      open={pendingDeleteTabs !== null}
      onOpenChange={(open) => !open && onCancelDeleteClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeleteTabs?.length === 1
              ? (() => {
                  const title = tabs.find(
                    (t) => t.id === pendingDeleteTabs[0],
                  )?.title;
                  return title
                    ? `"${title}" has unsaved changes. The file has been deleted. Close anyway?`
                    : "This file has unsaved changes. The file has been deleted. Close anyway?";
                })()
              : `${pendingDeleteTabs?.length ?? 0} files have unsaved changes. They have been deleted. Close all anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelDeleteClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmDeleteClose}>
            Close Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Prompt shown when a bulk close (close others / to the right) hits tabs with
 * unsaved changes or a running terminal process. */
export function BulkCloseDialog({
  pendingBulkClose,
  onCancelBulkClose,
  onConfirmBulkClose,
}: {
  pendingBulkClose: number[] | null;
  onCancelBulkClose: () => void;
  onConfirmBulkClose: () => void;
}) {
  const count = pendingBulkClose?.length ?? 0;
  return (
    <AlertDialog
      open={pendingBulkClose !== null}
      onOpenChange={(open) => !open && onCancelBulkClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close tabs?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? "1 tab has unsaved changes or a running process. Close it anyway?"
              : `${count} tabs have unsaved changes or running processes. Close them anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelBulkClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmBulkClose}>
            Close Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Prompt shown when quitting the app while a terminal process is running. */
export function AppCloseDialog({
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
}: {
  pendingAppClose: boolean;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
}) {
  return (
    <AlertDialog
      open={pendingAppClose}
      onOpenChange={(open) => !open && onCancelAppClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quit Termco?</AlertDialogTitle>
          <AlertDialogDescription>
            A process is still running in a terminal. Quitting will terminate
            it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelAppClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmAppClose}>
            Quit Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
