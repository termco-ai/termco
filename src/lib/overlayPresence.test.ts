// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anyOverlayOpen,
  decrementOverlays,
  incrementOverlays,
  manualOverlayOpen,
  openOverlayRects,
  subscribeOverlays,
} from "./overlayPresence";

afterEach(async () => {
  document.body.innerHTML = "";
  // Drain only the synchronous manual counter. `domOpen` is updated by the
  // MutationObserver on the next turn; looping on the combined state here
  // starves that observer forever after a DOM-overlay test.
  while (manualOverlayOpen()) {
    decrementOverlays();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("manual counter (non-Radix floating surfaces)", () => {
  it("is open while the count is positive and closes when balanced", () => {
    expect(anyOverlayOpen()).toBe(false);
    incrementOverlays();
    expect(anyOverlayOpen()).toBe(true);
    incrementOverlays();
    decrementOverlays();
    expect(anyOverlayOpen()).toBe(true);
    decrementOverlays();
    expect(anyOverlayOpen()).toBe(false);
  });

  it("never underflows below zero", () => {
    decrementOverlays();
    decrementOverlays();
    expect(anyOverlayOpen()).toBe(false);
    incrementOverlays();
    expect(anyOverlayOpen()).toBe(true);
    decrementOverlays();
    expect(anyOverlayOpen()).toBe(false);
  });
});

describe("DOM observation (Radix overlays)", () => {
  beforeEach(() => {
    // Ensure the observer is wired.
    subscribeOverlays(() => {});
  });

  it("detects an open popper wrapper and notifies", async () => {
    const changes: boolean[] = [];
    const unsub = subscribeOverlays(() => changes.push(anyOverlayOpen()));

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.appendChild(wrapper);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(true);

    wrapper.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(false);
    unsub();
  });

  it("notifies again when an already-open popper is positioned", async () => {
    const lefts: number[] = [];
    const unsub = subscribeOverlays(() => {
      const rect = openOverlayRects()[0];
      if (rect) lefts.push(rect.left);
    });
    let left = 0;
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    wrapper.getBoundingClientRect = () =>
      ({ left, x: left, top: 40, y: 40, right: left + 320, bottom: 340, width: 320, height: 300, toJSON: () => ({}) }) as DOMRect;

    // Radix first mounts the wrapper, then Popper positions it by updating its
    // inline style. Consumers need both geometry snapshots, even though the
    // aggregate "some overlay is open" Boolean never changes.
    document.body.appendChild(wrapper);
    await new Promise((r) => setTimeout(r, 0));
    left = 260;
    wrapper.style.transform = "translate(260px, 40px)";
    await new Promise((r) => setTimeout(r, 0));

    expect(lefts).toContain(0);
    expect(lefts).toContain(260);
    unsub();
  });

  it("detects an open dialog by data-state", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(true);

    // A closed dialog left mounted (Radix keeps Content in the tree) is NOT open.
    dialog.setAttribute("data-state", "closed");
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(false);
  });

  it("detects dialogs that do not use Radix state attributes", async () => {
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(true);
  });

  it.each([
    ["explicit Termco overlay", "data-termco-overlay", "true"],
    ["shared floating surface", "class", "termco-floating"],
    ["Sonner toast", "data-sonner-toast", ""],
  ])("detects an open %s", async (_name, attribute, value) => {
    const overlay = document.createElement("div");
    overlay.setAttribute(attribute, value);
    document.body.appendChild(overlay);
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(true);
  });

  it("ignores mounted-but-closed content (the boot-time false-positive bug)", async () => {
    // Mimic Radix mounting closed content in the tree at boot.
    const closed = document.createElement("div");
    closed.setAttribute("role", "dialog");
    closed.setAttribute("data-state", "closed");
    document.body.appendChild(closed);
    await new Promise((r) => setTimeout(r, 0));
    expect(anyOverlayOpen()).toBe(false);
  });
});

describe("rect exposure (so a native view hides only when actually covered)", () => {
  it("returns a rect per open Radix overlay, and none when closed", () => {
    expect(openOverlayRects()).toHaveLength(0);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.appendChild(wrapper);
    expect(openOverlayRects()).toHaveLength(1);
    // Closed content (still mounted) is not reported.
    const closed = document.createElement("div");
    closed.setAttribute("role", "dialog");
    closed.setAttribute("data-state", "closed");
    document.body.appendChild(closed);
    expect(openOverlayRects()).toHaveLength(1);
  });

  it("manualOverlayOpen tracks only the manual counter", () => {
    expect(manualOverlayOpen()).toBe(false);
    incrementOverlays();
    expect(manualOverlayOpen()).toBe(true);
    decrementOverlays();
    expect(manualOverlayOpen()).toBe(false);
  });
});
