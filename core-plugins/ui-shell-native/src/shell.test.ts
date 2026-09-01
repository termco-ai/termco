import { describe, expect, it, vi } from "vitest";
import type { UiContributionCapability } from "@termco/ui-shell-base";
import {
  type ContributionSource,
  createUiShellContributionStore,
} from "./registry";
import { createUiShell } from "./shell";

interface ElementNode {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

const element = (
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): ElementNode => ({ type, props, children });

function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const current = node as ElementNode;
  if (typeof current.type === "function") {
    return expand(
      current.type({
        ...(current.props ?? {}),
        children:
          current.children.length === 1 ? current.children[0] : current.children,
      }),
    );
  }
  return {
    ...current,
    children: current.children.map(expand),
  };
}

function findByTestId(node: unknown, testId: string): ElementNode | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByTestId(child, testId);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("type" in node)) return null;
  const current = node as ElementNode;
  if (current.props?.["data-testid"] === testId) return current;
  return findByTestId(current.children, testId);
}

function findByType(node: unknown, type: unknown): ElementNode | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByType(child, type);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("type" in node)) return null;
  const current = node as ElementNode;
  if (current.type === type) return current;
  return findByType(current.children, type);
}

function source<T extends { id: string }>(
  pluginId: string,
  values: readonly T[],
) {
  return {
    snapshot: () => values,
    records: () =>
      values.map((value) => ({
        pluginId,
        generation: "test-generation",
        key: value.id,
        value,
      })),
  };
}

function createHarness() {
  const createElement = vi.fn(element);
  const Toaster = "Toaster";
  const ThemeRoot = ({ children }: { children?: unknown }) => children;
  const TooltipProvider = ({ children }: { children?: unknown }) => children;
  const ErrorBoundary = ({ children }: { children?: unknown }) => children;
  const shell = createUiShell(
    {
      Fragment: ({ children }: { children?: unknown }) => children,
      createElement,
      useSyncExternalStore<T>(
        _subscribe: (listener: () => void) => () => void,
        snapshot: () => T,
      ) {
        return snapshot();
      },
    },
    {
      Root: ThemeRoot,
      subscribe: () => () => {},
      snapshot: () => ({ resolvedMode: "dark" }),
    } as never,
    createUiShellContributionStore(new Map<
      UiContributionCapability,
      ContributionSource
    >([
      [
        "ui.workspace.views",
        source(
          "workspace-shell-native",
          [
            {
              id: "workspace",
              label: "Workspace",
              description: "Workspace",
              Component: () => element("workspace-view", null),
            },
          ],
        ),
      ],
      [
        "ui.statusbar.items",
        source(
          "statusbar-native",
          [
            {
              id: "default-statusbar",
              label: "Default status bar",
              description: "Complete footer chrome",
              side: "root",
              Component: ({
                leftItems,
                rightItems,
              }: {
                leftItems?: unknown;
                rightItems?: unknown;
              }) =>
                element(
                  "complete-statusbar",
                  null,
                  leftItems,
                  rightItems,
                ),
            },
            {
              id: "external-left",
              label: "External left item",
              description: "Left extension",
              side: "left",
              Component: () => element("external-left", null),
            },
            {
              id: "external-right",
              label: "External right item",
              description: "Right extension",
              side: "right",
              Component: () => element("external-right", null),
            },
          ],
        ),
      ],
    ])),
    { TooltipProvider, ErrorBoundary, Toaster },
  );
  return { shell, createElement, ErrorBoundary, Toaster };
}

describe("ui shell", () => {
  it("exposes only the complete plugin-owned application root", () => {
    const { shell } = createHarness();

    expect(Object.keys(shell)).toEqual(["Root"]);
    expect(typeof shell.Root).toBe("function");
  });

  it("renders the established shell slots and complete statusbar through Root", () => {
    const { shell, createElement, ErrorBoundary, Toaster } = createHarness();
    const tree = expand(element(shell.Root, null));

    expect(findByTestId(tree, "core-shell")).not.toBeNull();
    expect(findByTestId(tree, "slot-header")).not.toBeNull();
    expect(findByTestId(tree, "slot-workspace")).not.toBeNull();
    expect(findByTestId(tree, "slot-statusbar")).not.toBeNull();
    expect(findByTestId(tree, "slot-background")).not.toBeNull();
    expect(findByType(tree, "complete-statusbar")).not.toBeNull();
    expect(findByType(tree, "external-left")).not.toBeNull();
    expect(findByType(tree, "external-right")).not.toBeNull();
    expect(createElement).not.toHaveBeenCalledWith("footer", expect.anything());
    expect(createElement).toHaveBeenCalledWith(
      ErrorBoundary,
      expect.objectContaining({
        key: "workspace:workspace-shell-native:test-generation:workspace",
        owner: "workspace-shell-native",
      }),
      expect.anything(),
    );
    expect(createElement).toHaveBeenCalledWith(
      Toaster,
      expect.objectContaining({
        theme: "dark",
        position: "bottom-right",
        className: "toaster group",
      }),
    );
  });
});
