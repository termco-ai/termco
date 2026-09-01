// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTabFileActions } from "./useTabFileActions";

afterEach(cleanup);

function setup() {
  const api = {
    newTab: vi.fn(() => 99),
    newPrivateTab: vi.fn(() => 99),
    newBlockTab: vi.fn(() => 99),
  };
  const inheritedCwdForNewTab = vi.fn(() => "/inherited");
  const render = renderHook(() =>
    useTabFileActions({
      ...api,
      inheritedCwdForNewTab,
    }),
  );
  return { ...render, ...api, inheritedCwdForNewTab };
}

describe("new tab openers", () => {
  it("open terminal/private/block tabs with the inherited cwd", () => {
    const s = setup();
    s.result.current.openNewTab();
    s.result.current.openNewPrivateTab();
    s.result.current.openNewBlockTab();
    expect(s.newTab).toHaveBeenCalledWith("/inherited");
    expect(s.newPrivateTab).toHaveBeenCalledWith("/inherited");
    expect(s.newBlockTab).toHaveBeenCalledWith("/inherited");
  });
});
