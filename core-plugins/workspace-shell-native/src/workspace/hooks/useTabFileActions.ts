import type { useTabs } from "../tabs";
import { useCallback } from "react";

type TabsApi = ReturnType<typeof useTabs>;

type Params = Pick<TabsApi, "newTab" | "newPrivateTab" | "newBlockTab"> & {
  inheritedCwdForNewTab: () => string | undefined;
};

/** New terminal/private/block tabs inherit the active pane's cwd. */
export function useTabFileActions({
  newTab,
  newPrivateTab,
  newBlockTab,
  inheritedCwdForNewTab,
}: Params) {
  const openNewTab = useCallback(
    () => newTab(inheritedCwdForNewTab()),
    [newTab, inheritedCwdForNewTab],
  );

  const openNewPrivateTab = useCallback(
    () => newPrivateTab(inheritedCwdForNewTab()),
    [newPrivateTab, inheritedCwdForNewTab],
  );

  const openNewBlockTab = useCallback(
    () => newBlockTab(inheritedCwdForNewTab()),
    [newBlockTab, inheritedCwdForNewTab],
  );

  return {
    openNewTab,
    openNewPrivateTab,
    openNewBlockTab,
  };
}
