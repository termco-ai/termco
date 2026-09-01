import type { ApplicationUpdateStatus, ManualUpdateInfo } from "@termco/application-base";

export type UpdaterStatus = ApplicationUpdateStatus;
export type { ManualUpdateInfo };

export type UpdaterProgressEvent =
  | { event: "Started"; data?: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };
