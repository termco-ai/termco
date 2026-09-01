import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import { renderRendererProfileRoot } from "./renderRendererProfileRoot";

vi.mock("react-dom", () => ({
  flushSync: vi.fn((render: () => void) => render()),
}));

describe("renderer profile root", () => {
  it("unmounts the shell while the renderer profile is quiesced", () => {
    const render = vi.fn();
    renderRendererProfileRoot({ render }, null);

    expect(flushSync).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("still rejects a settled profile that does not provide ui.shell", () => {
    const render = vi.fn();
    const platformCapability = vi.fn(() => {
      throw new Error('capability "ui.shell" is unavailable in this process');
    });

    expect(() =>
      renderRendererProfileRoot({ render }, {
        runtime: { platformCapability },
      } as never),
    ).toThrow('capability "ui.shell" is unavailable in this process');
    expect(render).not.toHaveBeenCalled();
  });
});
