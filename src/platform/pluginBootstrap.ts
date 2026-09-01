export type PluginBootstrapStage =
  | "connecting"
  | "verifying"
  | "downloading"
  | "preparing"
  | "activating";

export type PluginBootstrapStatus =
  | { kind: "ready" }
  | { kind: "recovery"; message: string }
  | {
      kind: "required";
      repository: string;
      applicationVersion: string;
    };

export interface PluginBootstrapProgress {
  stage: PluginBootstrapStage;
  completed: number;
  total: number;
  pluginName?: string;
}

export interface PluginBootstrapResult {
  status: "installed";
  releaseId: string;
  pluginCount: number;
}
