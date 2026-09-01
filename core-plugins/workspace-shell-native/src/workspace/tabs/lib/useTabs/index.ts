/**
 * Plugin-local surface of the typed workspace-tab orchestration adapter.
 * Consumers inside this plugin share one model without reaching into host
 * source or owning a second tab store.
 */

export { useTabs } from "./hook";
export {
  type BulkCloseMode,
  planBulkClose,
  planRigRemoval,
} from "./tabOps";
export {
  type AiDiffStatus,
  type AiDiffTab,
  type ContainerRuntime,
  DEFAULT_RIG_ID,
  type EditorTab,
  type GitCommitFileDiffTab,
  type GitDiffTab,
  type GitHistoryTab,
  isPluginTab,
  MAX_PANES_PER_TAB,
  type MarkdownTab,
  type PluginTab,
  type PluginTabKind,
  type PreviewTab,
  type Tab,
  type TerminalTab,
  type TrajectoryTab,
} from "./tabTypes";
