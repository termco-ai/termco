// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { ContributionRecord } from "@termco/kernel";
import type {
  UiTabKindContribution,
  UiTabSurfaceProps,
  UiTabsRuntime,
} from "@termco/ui-tabs-base";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurfaceHost } from "./SurfaceHost";

const ALWAYS_SURFACES = [
  "terminal",
  "editor",
  "preview",
  "markdown",
  "ai-diff",
  "git-diff",
  "git-history",
] as const;

const capturedProps = new Map<string, UiTabSurfaceProps>();

function FakeSurface(testId: string) {
  return function Fake(props: UiTabSurfaceProps) {
    capturedProps.set(testId, props);
    return (
      <div
        data-testid={`stack-${testId}`}
        data-active-id={String(props.activeId)}
      />
    );
  };
}

const COMPONENTS: Record<string, ReturnType<typeof FakeSurface>> = {
  terminal: FakeSurface("terminal"),
  editor: FakeSurface("editor"),
  preview: FakeSurface("preview"),
  markdown: FakeSurface("markdown"),
  "ai-diff": FakeSurface("ai-diff"),
  "git-diff": FakeSurface("git-diff"),
  "git-history": FakeSurface("git-history"),
  container: FakeSurface("container"),
  plugin: FakeSurface("plugin-notes"),
};

function entry(
  id: string,
  kinds: string[],
  options: Partial<UiTabKindContribution> = {},
): ContributionRecord<UiTabKindContribution> {
  return {
    key: id,
    pluginId: `${id}-plugin`,
    generation: `sha256-${id}`,
    value: {
      id,
      label: id,
      description: `${id} surface`,
      kinds,
      Component: COMPONENTS[id],
      ...options,
    },
  };
}

function contributions(): ContributionRecord<UiTabKindContribution>[] {
  return [
    entry("terminal", ["terminal"]),
    entry("editor", ["editor"]),
    entry("preview", ["preview"], { receivesVisibility: true }),
    entry("markdown", ["markdown"]),
    entry("ai-diff", ["ai-diff"]),
    entry("git-diff", ["git-diff", "git-commit-file"]),
    entry("git-history", ["git-history"]),
    entry("container", ["container"], { mountWhen: "whenOpen" }),
  ];
}

const runtime = {} as UiTabsRuntime;
const createRuntime = vi.fn(() => runtime);

beforeEach(() => {
  capturedProps.clear();
  createRuntime.mockClear();
});

afterEach(cleanup);

function makeTab(kind: Tab["kind"], id = 1): Tab {
  const base = { id, rigId: "default", title: "t" };
  switch (kind) {
    case "terminal":
      return {
        ...base,
        kind,
        paneTree: { kind: "leaf", id: 10 },
        activeLeafId: 10,
      };
    case "editor":
      return { ...base, kind, path: "/f.ts", dirty: false, preview: false };
    case "preview":
      return { ...base, kind, url: "http://localhost" };
    case "markdown":
      return { ...base, kind, path: "/f.md" };
    case "ai-diff":
      return {
        ...base,
        kind,
        path: "/f.ts",
        originalContent: "",
        proposedContent: "x",
        approvalId: "a",
        status: "pending",
        isNewFile: false,
      };
    case "git-diff":
      return {
        ...base,
        kind,
        path: "f.ts",
        repoRoot: "/repo",
        mode: "-",
        originalPath: null,
      };
    case "git-history":
      return { ...base, kind, repoRoot: "/repo" };
    case "git-commit-file":
      return {
        ...base,
        kind,
        repoRoot: "/repo",
        sha: "abc",
        shortSha: "abc",
        subject: "s",
        path: "f.ts",
        originalPath: null,
      };
    case "container":
      return {
        ...base,
        kind,
        runtime: "docker",
        containerId: "abc123",
        name: "web",
      };
    case "trajectory":
      return { ...base, kind, data: { sessionId: "session-1" } };
    default:
      return { ...base, kind };
  }
}

function renderHost(
  activeTab: Tab | undefined,
  extraTabs: Tab[] = [],
  entries = contributions(),
) {
  return render(
    <SurfaceHost
      tabs={activeTab ? [activeTab, ...extraTabs] : extraTabs}
      activeId={activeTab?.id ?? 0}
      activeTab={activeTab}
      contributions={entries}
      createRuntime={createRuntime}
    />,
  );
}

function hiddenState() {
  return Object.fromEntries(
    ALWAYS_SURFACES.map((surface) => [
      surface,
      screen
        .getByTestId(`stack-${surface}`)
        .parentElement?.getAttribute("aria-hidden"),
    ]),
  );
}

describe("source-owned SurfaceHost", () => {
  it("keeps every always-mounted contribution alive and defers whenOpen contributions", () => {
    renderHost(makeTab("terminal"));
    for (const surface of ALWAYS_SURFACES) {
      expect(screen.getByTestId(`stack-${surface}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("stack-container")).toBeNull();
  });

  it.each(ALWAYS_SURFACES)("reveals only the %s contribution", (kind) => {
    renderHost(makeTab(kind));
    const state = hiddenState();
    for (const surface of ALWAYS_SURFACES) {
      expect(state[surface]).toBe(surface === kind ? "false" : "true");
    }
  });

  it("maps git commit files to the shared Git diff renderer", () => {
    renderHost(makeTab("git-commit-file"));
    expect(hiddenState()["git-diff"]).toBe("false");
  });

  it("hides all contributions without an active tab", () => {
    renderHost(undefined);
    for (const state of Object.values(hiddenState())) expect(state).toBe("true");
  });

  it("mounts a whenOpen contribution only while its tab exists", () => {
    renderHost(makeTab("terminal"), [makeTab("container", 2)]);
    expect(
      screen.getByTestId("stack-container").parentElement?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("threads descriptors, active id, public runtime, and visibility semantics", () => {
    renderHost(makeTab("preview"), [makeTab("terminal", 2)]);
    expect(capturedProps.get("preview")?.activeId).toBe(1);
    expect(capturedProps.get("preview")?.tabs[0]).toMatchObject({
      id: 1,
      kind: "preview",
      url: "http://localhost",
    });
    expect(capturedProps.get("preview")?.runtime).toBe(runtime);
    expect(capturedProps.get("preview")?.surfaceVisible).toBe(true);
    expect(capturedProps.get("terminal")?.surfaceVisible).toBe(true);
    cleanup();
    renderHost(makeTab("terminal"), [makeTab("preview", 2)]);
    expect(capturedProps.get("preview")?.surfaceVisible).toBe(false);
  });

  it("preserves an unclaimed plugin tab and revives it when its contribution returns", () => {
    const pluginTab = makeTab("plugin:sample:notes");
    const view = renderHost(pluginTab);
    expect(screen.getByTestId("plugin-tab-placeholder")).toBeTruthy();
    view.rerender(
      <SurfaceHost
        tabs={[pluginTab]}
        activeId={pluginTab.id}
        activeTab={pluginTab}
        contributions={[
          entry("plugin", ["plugin:sample:notes"], {
            Component: COMPONENTS.plugin,
          }),
        ]}
        createRuntime={createRuntime}
      />,
    );
    expect(screen.queryByTestId("plugin-tab-placeholder")).toBeNull();
    expect(screen.getByTestId("stack-plugin-notes")).toBeTruthy();
  });

  it("does not show the plugin placeholder for an unclaimed built-in kind", () => {
    renderHost(makeTab("trajectory"));
    expect(screen.queryByTestId("plugin-tab-placeholder")).toBeNull();
  });
});
