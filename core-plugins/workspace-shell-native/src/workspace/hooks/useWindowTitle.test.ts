// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { DesktopWindowCapability } from "@termco/desktop-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowTitle } from "./useWindowTitle";

afterEach(cleanup);

const setTitle = vi.fn(() => Promise.resolve());
const desktopWindow = { setTitle } as unknown as DesktopWindowCapability;
const SEP = " \u2014 ";

function term(cwd?: string, leafCwd?: string): Tab {
  return {
    id: 1,
    kind: "terminal",
    rigId: "default",
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: 2, cwd: leafCwd },
    activeLeafId: 2,
  };
}

function mount(activeTab: Tab | undefined, explorerRoot: string | null) {
  return renderHook(
    ({ tab, root }: { tab: Tab | undefined; root: string | null }) =>
      useWindowTitle(tab, root, desktopWindow),
    { initialProps: { tab: activeTab, root: explorerRoot } },
  );
}

beforeEach(() => {
  setTitle.mockClear();
  document.title = "";
});

describe("useWindowTitle", () => {
  it("combines project and tab label", () => {
    mount(term("/w/proj", "/w/proj/src"), "/w/proj");
    expect(document.title).toBe(`proj${SEP}src`);
    expect(setTitle).toHaveBeenCalledWith(`proj${SEP}src`);
  });

  it("collapses to the project when the tab sits at the root", () => {
    mount(term("/w/proj", "/w/proj"), "/w/proj");
    expect(document.title).toBe("proj");
  });

  it("uses the tab cwd when the active leaf has none", () => {
    mount(term("/w/other", undefined), "/w/proj");
    expect(document.title).toBe(`proj${SEP}other`);
  });

  it("falls back to the terminal title without any cwd", () => {
    mount(term(undefined, undefined), null);
    expect(document.title).toBe("shell");
  });

  it("uses the stored title for non-terminal tabs", () => {
    const editor: Tab = {
      id: 3,
      kind: "editor",
      rigId: "default",
      title: "foo.ts",
      path: "/w/proj/foo.ts",
      dirty: false,
      preview: false,
    };
    mount(editor, "/w/proj");
    expect(document.title).toBe(`proj${SEP}foo.ts`);
  });

  it("falls back to the app name when there is nothing to show", () => {
    mount(undefined, null);
    expect(document.title).toBe("Termco");
    expect(setTitle).toHaveBeenCalledWith("Termco");
  });

  it("updates when the tab changes", () => {
    const { rerender } = mount(term("/w/proj", "/w/proj/src"), "/w/proj");
    rerender({ tab: term("/w/proj", "/w/proj/lib"), root: "/w/proj" });
    expect(document.title).toBe(`proj${SEP}lib`);
  });
});
