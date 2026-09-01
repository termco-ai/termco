/**
 * Tab data model: the discriminated union of every kind of workspace tab
 * (terminal, editor, preview, markdown, ai-diff, git-diff/history/commit-file)
 * plus the generic `plugin:*` tab, the shared base shape, the patch shape used
 * by `updateTab`, and the two frozen constants that bound tab behaviour.
 *
 * These are pure type/constant declarations (plus the one `isPluginTab` guard
 * the template-literal discriminant needs); the state machine that operates on
 * them lives in `./hook` and `./tabOps`.
 */
import type { PaneNode } from "../panes";

/** Container engine backing a container tab (mirrors containers module's type;
 * inlined so the tab model has no dependency on the containers module). */
export type ContainerRuntime = "docker" | "podman" | "apple";

/** Matches the renderer slot pool size — over this we'd evict an active leaf. */
export const MAX_PANES_PER_TAB = 4;

/** Rig that every workspace starts in and falls back to. */
export const DEFAULT_RIG_ID = "default";

/** Fields common to every tab kind. */
type TabBase = {
  rigId: string;
  /** Restored from disk, not yet activated: rendered as a placeholder, not mounted. */
  cold?: boolean;
};

/** A shell/terminal tab, optionally split into a tree of panes. */
export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  /** AI agent cannot read buffer / context of this terminal. */
  private?: boolean;
  /** User-set label that overrides the cwd-derived name. Survives cd. */
  customTitle?: string;
};

/** A code/text editor tab bound to a file path. */
export type EditorTab = TabBase & {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
  overrideLanguage?: string | null;
};

/** An embedded web preview tab. */
export type PreviewTab = TabBase & {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

/** A rendered-markdown tab. */
export type MarkdownTab = TabBase & {
  id: number;
  kind: "markdown";
  title: string;
  path: string;
};

/** Approval state of an AI-proposed file diff. */
export type AiDiffStatus = "pending" | "approved" | "rejected";

/** A diff tab surfacing an AI edit awaiting user approval. */
export type AiDiffTab = TabBase & {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  /** "" for newly created files. */
  originalContent: string;
  proposedContent: string;
  /** Tool-call approval id used to resolve the AI SDK approval. */
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
};

/** A working-tree diff tab for a single file in a repository. */
export type GitDiffTab = TabBase & {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
};

/** A commit-graph / history tab for a repository. */
export type GitHistoryTab = TabBase & {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
};

/** A diff tab for one file within a specific commit. */
export type GitCommitFileDiffTab = TabBase & {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

/** A rich detail/inspector tab bound to one container (like an editor tab per
 * file). Multiple can be open at once; the title is the container name. */
export type ContainerTab = TabBase & {
  id: number;
  kind: "container";
  title: string;
  runtime: ContainerRuntime;
  containerId: string;
  name: string;
};

/** A source-owned Trajectory surface. Its current data contract belongs to the
 * contributing plugin and remains opaque to the workspace shell. */
export type TrajectoryTab = TabBase & {
  id: number;
  kind: "trajectory";
  title: string;
  data?: Record<string, unknown>;
};

/** The namespace every third-party tab kind lives in. The `plugin:` prefix is
 * mandatory for kinds opened via the public `tabs.open()` — it keeps plugin
 * kinds collision-free against present AND future built-in kinds. */
export type PluginTabKind = `plugin:${string}`;

/** A generic tab owned by a plugin-registered kind (public `tabs.open()`).
 * `data` is an opaque, JSON-serializable payload the owning plugin's Stack
 * receives back; it is persisted with the rig. */
export type PluginTab = TabBase & {
  id: number;
  kind: PluginTabKind;
  title: string;
  data?: Record<string, unknown>;
};

/** Narrow a tab to the generic plugin-tab shape (`plugin:*` kinds). */
export function isPluginTab(t: Tab): t is PluginTab {
  return t.kind.startsWith("plugin:");
}

/** The full set of tab kinds a workspace can hold. */
export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab
  | ContainerTab
  | TrajectoryTab
  | PluginTab;

/** Partial update accepted by `updateTab`, spanning fields across tab kinds. */
export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  /** Empty string resets a terminal tab to its cwd-derived name. */
  customTitle: string;
  overrideLanguage: string | null;
}>;
