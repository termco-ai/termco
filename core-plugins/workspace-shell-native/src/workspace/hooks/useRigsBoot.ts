import { useEffect, useRef } from "react";
import { runRigsBoot, type RigsBootParams } from "../lib/runRigsBoot";

export function useRigsBoot(params: RigsBootParams): void {
  const done = useRef(false);
  useEffect(() => {
    if (!params.ready || done.current) return;
    done.current = true;
    void runRigsBoot(params);
  }, [params]);
}
