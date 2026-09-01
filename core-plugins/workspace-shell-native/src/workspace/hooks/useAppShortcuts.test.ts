// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { AgentActivityCapability } from "@termco/agents-base";
import type { AiSessionsCapability } from "@termco/ai-sessions-base";
import type { EditorNavigationCapability, EditorSessionsCapability } from "@termco/editor-base";
import type {
  ShortcutHandlers,
  ShortcutId,
  ShortcutRegistryCapability,
} from "@termco/shortcuts-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppShortcuts } from "./useAppShortcuts";

const registry = vi.hoisted(() => ({
  handlers: null as ShortcutHandlers | null,
  isDisabled: null as ((id: ShortcutId, e: KeyboardEvent) => boolean) | null,
}));
const editor = vi.hoisted(() => ({
  openNewFile: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
}));

const shortcuts = {
  useHandlers: vi.fn(
    (
      handlers: ShortcutHandlers,
      opts: { isDisabled: (id: ShortcutId, e: KeyboardEvent) => boolean },
    ) => {
      registry.handlers = handlers;
      registry.isDisabled = opts.isDisabled;
    },
  ),
} as unknown as ShortcutRegistryCapability;
const editorNavigation = {
  openNewFile: editor.openNewFile,
} as unknown as EditorNavigationCapability;
const editorSessions = {
  undo: editor.undo,
  redo: editor.redo,
} as unknown as EditorSessionsCapability;

vi.mock("../tabs", () => ({ DEFAULT_RIG_ID: "default" }));

const terminalSessions = {
  clearFocused: vi.fn(),
  navigateFocusedBlocks: vi.fn(),
} as unknown as TerminalSessionsCapability;

const aiSessions: AiSessionsCapability = vi.hoisted(() => ({
  snapshot: vi.fn(() => ({
    revision: 0,
    panelOpen: false,
    miniOpen: false,
    selectedModelId: "",
    activeSessionId: null,
    agent: { status: "idle" as const, step: null, error: null },
  })),
  subscribe: vi.fn(() => () => undefined),
  togglePanel: vi.fn(),
  openPanel: vi.fn(),
  closePanel: vi.fn(),
  openMini: vi.fn(),
  closeMini: vi.fn(),
  focusInput: vi.fn(),
  attachSelection: vi.fn(),
  attachFile: vi.fn(),
  attachImage: vi.fn(),
  openSession: vi.fn(async () => undefined),
  rerunFrom: vi.fn(async () => ({ childSessionId: "child-session" as never })),
  sessionContext: vi.fn(() => null),
  sendMessage: vi.fn(async () => undefined),
  respondToApproval: vi.fn(),
}));
const captureActiveSelection = vi.hoisted(() =>
  vi.fn((): string | null => null),
);
const nextAttentionTarget = vi.hoisted(() => vi.fn());
const agentActivity = {
  nextAttentionTarget,
} as unknown as AgentActivityCapability;

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "term",
  rigId: "default",
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
};

const blockTab: Tab = { ...terminalTab, blocks: true } as Tab;

const editorTab: Tab = {
  id: 2,
  kind: "editor",
  title: "f",
  rigId: "default",
  path: "/f.ts",
  dirty: false,
  preview: false,
};

function setup(over?: {
  activeTab?: Tab;
  activeRigId?: string | null;
  selection?: string | null;
}) {
  const fns = {
    selectByIndex: vi.fn(),
    focusNextPaneInTab: vi.fn(),
    openNewTab: vi.fn(),
    openNewBlockTab: vi.fn(),
    openNewPrivateTab: vi.fn(),
    openPreviewTab: vi.fn(() => 1),
    handleCloseTabOrPane: vi.fn(),
    cycleRig: vi.fn(),
    setSwitcherOpen: vi.fn(),
    splitActivePaneInActiveTab: vi.fn(),
    toggleSourceControl: vi.fn(),
    activateAgentTarget: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleExplorerFocus: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    setZenMode: vi.fn(),
    captureActiveSelection,
    openSettings: vi.fn(),
    aiSessions,
    agentActivity,
    shortcuts,
    editorNavigation,
    editorSessions,
    terminalSessions,
    focusSearch: vi.fn(),
  };
  captureActiveSelection.mockImplementation(() => over?.selection ?? null);
  const searchFocus = fns.focusSearch;
  renderHook(() =>
    useAppShortcuts({
      ...fns,
      activeId: 7,
      activeRigId: over?.activeRigId === undefined ? "rig-a" : over.activeRigId,
      activeTab: over?.activeTab ?? terminalTab,
    }),
  );
  const handlers = registry.handlers;
  const isDisabled = registry.isDisabled;
  if (!handlers || !isDisabled) throw new Error("shortcuts not registered");
  const fire = (id: ShortcutId, e?: Partial<KeyboardEvent>) =>
    handlers[id]?.((e ?? {}) as KeyboardEvent);
  return {
    fns,
    undo: editor.undo,
    redo: editor.redo,
    openNewFile: editor.openNewFile,
    searchFocus,
    handlers,
    isDisabled,
    fire,
  };
}

function keyEvent(over?: Partial<{ target: EventTarget; shiftKey: boolean }>) {
  return { shiftKey: false, ...over } as unknown as KeyboardEvent;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});
beforeEach(() => {
  vi.clearAllMocks();
  registry.handlers = null;
  registry.isDisabled = null;
});

describe("shortcut handler wiring", () => {
  it("wires tab, rig, pane and view shortcuts to their handlers", () => {
    const s = setup();
    s.fire("tab.new");
    expect(s.fns.openNewTab).toHaveBeenCalled();
    s.fire("tab.newBlock");
    expect(s.fns.openNewBlockTab).toHaveBeenCalled();
    s.fire("tab.newPrivate");
    expect(s.fns.openNewPrivateTab).toHaveBeenCalled();
    s.fire("tab.newPreview");
    expect(s.fns.openPreviewTab).toHaveBeenCalledWith("");
    s.fire("tab.newEditor");
    expect(s.openNewFile).toHaveBeenCalled();
    s.fire("tab.close");
    expect(s.fns.handleCloseTabOrPane).toHaveBeenCalled();
    expect(s.handlers["tab.next"]).toBeUndefined();
    expect(s.handlers["tab.prev"]).toBeUndefined();

    s.fire("rig.next");
    expect(s.fns.cycleRig).toHaveBeenLastCalledWith(1);
    s.fire("rig.prev");
    expect(s.fns.cycleRig).toHaveBeenLastCalledWith(-1);
    s.fire("rig.overview");
    expect(s.fns.setSwitcherOpen).toHaveBeenCalledWith(true);

    s.fire("pane.splitRight");
    expect(s.fns.splitActivePaneInActiveTab).toHaveBeenLastCalledWith("row");
    s.fire("pane.splitDown");
    expect(s.fns.splitActivePaneInActiveTab).toHaveBeenLastCalledWith("col");
    s.fire("pane.focusNext");
    expect(s.fns.focusNextPaneInTab).toHaveBeenLastCalledWith(7, 1);
    s.fire("pane.focusPrev");
    expect(s.fns.focusNextPaneInTab).toHaveBeenLastCalledWith(7, -1);
    s.fire("pane.source");
    expect(s.fns.toggleSourceControl).toHaveBeenCalled();

    s.fire("search.focus");
    expect(s.searchFocus).toHaveBeenCalled();
    s.fire("ai.toggle");
    expect(aiSessions.togglePanel).toHaveBeenCalled();
    captureActiveSelection.mockReturnValue("selected");
    s.fire("ai.askSelection");
    expect(aiSessions.openPanel).toHaveBeenCalled();
    expect(aiSessions.attachSelection).toHaveBeenCalledWith(
      "selected",
      "terminal",
    );
    s.fire("settings.open");
    expect(s.fns.openSettings).toHaveBeenCalledWith();
    s.fire("sidebar.toggle");
    expect(s.fns.toggleSidebar).toHaveBeenCalled();
    s.fire("explorer.focus");
    expect(s.fns.toggleExplorerFocus).toHaveBeenCalled();
    s.fire("view.zoomIn");
    expect(s.fns.zoomIn).toHaveBeenCalled();
    s.fire("view.zoomOut");
    expect(s.fns.zoomOut).toHaveBeenCalled();
    s.fire("view.zoomReset");
    expect(s.fns.zoomReset).toHaveBeenCalled();
  });

  it("selects a tab by its 1-based key index within the active rig", () => {
    const s = setup({ activeRigId: "rig-a" });
    s.fire("tab.selectByIndex", { key: "3" });
    expect(s.fns.selectByIndex).toHaveBeenCalledWith(2, "rig-a");
  });

  it("falls back to the default rig for index selection", () => {
    const s = setup({ activeRigId: null });
    s.fire("tab.selectByIndex", { key: "1" });
    expect(s.fns.selectByIndex).toHaveBeenCalledWith(0, "default");
  });

  it("toggles zen mode with a functional update", () => {
    const s = setup();
    s.fire("view.zenMode");
    const updater = s.fns.setZenMode.mock.calls[0][0] as (
      v: boolean,
    ) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it("clears the focused terminal and navigates blocks", () => {
    const s = setup();
    s.fire("terminal.clear");
    expect(terminalSessions.clearFocused).toHaveBeenCalled();
    s.fire("blocks.prev");
    expect(terminalSessions.navigateFocusedBlocks).toHaveBeenLastCalledWith(-1);
    s.fire("blocks.next");
    expect(terminalSessions.navigateFocusedBlocks).toHaveBeenLastCalledWith(1);
  });

  it("dispatches the toggle-block-input window event", () => {
    const s = setup();
    const listener = vi.fn();
    window.addEventListener("termco:toggle-block-input", listener);
    s.fire("terminal.toggleInput");
    window.removeEventListener("termco:toggle-block-input", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("focuses the next agent needing attention when one exists", () => {
    const s = setup();
    nextAttentionTarget.mockReturnValue(null);
    s.fire("agent.focusAttention");
    expect(s.fns.activateAgentTarget).not.toHaveBeenCalled();
    nextAttentionTarget.mockReturnValue({ tabId: 4, leafId: 40 });
    s.fire("agent.focusAttention");
    expect(s.fns.activateAgentTarget).toHaveBeenCalledWith(4, 40);
  });

  it("routes editor undo/redo to the active editor handle", () => {
    const s = setup({ activeTab: editorTab });
    s.fire("editor.undo");
    expect(s.undo).toHaveBeenCalled();
    s.fire("editor.redo");
    expect(s.redo).toHaveBeenCalled();
  });
});

describe("context-sensitive disabling", () => {
  it("disables editor undo/redo outside editor tabs", () => {
    const s = setup({ activeTab: terminalTab });
    expect(s.isDisabled("editor.undo", keyEvent())).toBe(true);
    expect(s.isDisabled("editor.redo", keyEvent())).toBe(true);
  });

  it("enables editor undo/redo in editor tabs", () => {
    const s = setup({ activeTab: editorTab });
    expect(s.isDisabled("editor.undo", keyEvent())).toBe(false);
    expect(s.isDisabled("editor.redo", keyEvent())).toBe(false);
  });

  it("only intercepts terminal.clear while a terminal is focused", () => {
    const s = setup();
    const term = document.createElement("div");
    term.className = "terminal-host";
    const inner = document.createElement("span");
    term.appendChild(inner);
    document.body.appendChild(term);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(s.isDisabled("terminal.clear", keyEvent({ target: inner }))).toBe(
      false,
    );
    expect(s.isDisabled("terminal.clear", keyEvent({ target: outside }))).toBe(
      true,
    );
  });

  it("allows ai.askSelection outside terminals without checking selection", () => {
    const s = setup({ selection: null });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(s.isDisabled("ai.askSelection", keyEvent({ target: outside }))).toBe(
      false,
    );
  });

  it("disables ai.askSelection in a terminal without a selection", () => {
    const s = setup({ selection: "  " });
    const term = document.createElement("div");
    term.className = "terminal-host";
    const inner = document.createElement("span");
    term.appendChild(inner);
    document.body.appendChild(term);
    expect(s.isDisabled("ai.askSelection", keyEvent({ target: inner }))).toBe(
      true,
    );
  });

  it("enables ai.askSelection in a terminal with a selection", () => {
    const s = setup({ selection: "picked text" });
    const term = document.createElement("div");
    term.className = "terminal-host";
    const inner = document.createElement("span");
    term.appendChild(inner);
    document.body.appendChild(term);
    expect(s.isDisabled("ai.askSelection", keyEvent({ target: inner }))).toBe(
      false,
    );
  });

  it("gates block shortcuts on an active block terminal tab", () => {
    const blocks = setup({ activeTab: blockTab });
    expect(blocks.isDisabled("terminal.toggleInput", keyEvent())).toBe(false);
    expect(blocks.isDisabled("blocks.prev", keyEvent())).toBe(false);
    expect(blocks.isDisabled("blocks.next", keyEvent())).toBe(false);
    cleanup();
    const plain = setup({ activeTab: terminalTab });
    expect(plain.isDisabled("terminal.toggleInput", keyEvent())).toBe(true);
    expect(plain.isDisabled("blocks.prev", keyEvent())).toBe(true);
    cleanup();
    const editor = setup({ activeTab: editorTab });
    expect(editor.isDisabled("blocks.next", keyEvent())).toBe(true);
  });

  it("defers plain Ctrl+B to a focused terminal but keeps Shift+B", () => {
    const s = setup();
    const term = document.createElement("div");
    term.className = "terminal-host";
    const inner = document.createElement("span");
    term.appendChild(inner);
    document.body.appendChild(term);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(
      s.isDisabled(
        "sidebar.toggle",
        keyEvent({ target: inner, shiftKey: false }),
      ),
    ).toBe(true);
    expect(
      s.isDisabled(
        "sidebar.toggle",
        keyEvent({ target: inner, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      s.isDisabled(
        "sidebar.toggle",
        keyEvent({ target: outside, shiftKey: false }),
      ),
    ).toBe(false);
  });

  it("never disables unlisted shortcuts", () => {
    const s = setup();
    expect(s.isDisabled("tab.new", keyEvent())).toBe(false);
  });
});
