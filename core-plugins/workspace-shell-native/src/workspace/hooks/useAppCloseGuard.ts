import type { DesktopWindowCapability } from "@termco/desktop-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export function useAppCloseGuard(
  desktopWindow: DesktopWindowCapability,
  terminalSessions: TerminalSessionsCapability,
) {
  const [pendingAppClose, setPendingAppClose] = useState(false);
  const forceClose = useRef(false);

  useEffect(() => {
    return desktopWindow.onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        if (await terminalSessions.hasForegroundProcesses()) {
          setPendingAppClose(true);
        } else {
          forceClose.current = true;
          void desktopWindow.close();
        }
      });
  }, [desktopWindow, terminalSessions]);

  const confirmAppClose = useCallback(() => {
    setPendingAppClose(false);
    forceClose.current = true;
    void desktopWindow.close();
  }, [desktopWindow]);

  const cancelAppClose = useCallback(() => setPendingAppClose(false), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
