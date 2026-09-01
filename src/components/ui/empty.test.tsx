// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";

afterEach(cleanup);

describe("Empty", () => {
  it("renders the empty state composition with slot attributes", () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia>media</EmptyMedia>
          <EmptyTitle>No results</EmptyTitle>
          <EmptyDescription>Try a different query</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>content</EmptyContent>
      </Empty>,
    );
    expect(screen.getByText("No results")).toHaveAttribute(
      "data-slot",
      "empty-title",
    );
    expect(screen.getByText("Try a different query")).toHaveAttribute(
      "data-slot",
      "empty-description",
    );
    expect(screen.getByText("content")).toHaveAttribute(
      "data-slot",
      "empty-content",
    );
    expect(screen.getByText("media")).toHaveAttribute(
      "data-slot",
      "empty-icon",
    );
  });

  it("supports the icon media variant", () => {
    render(<EmptyMedia variant="icon">i</EmptyMedia>);
    const el = screen.getByText("i");
    expect(el).toHaveAttribute("data-variant", "icon");
    expect(el.className).toContain("bg-[var(--signal-soft)]");
  });

  it("defaults media to the transparent variant", () => {
    render(<EmptyMedia>i</EmptyMedia>);
    const el = screen.getByText("i");
    expect(el).toHaveAttribute("data-variant", "default");
    expect(el.className).toContain("bg-transparent");
  });

  it("merges custom classes on the root", () => {
    const { container } = render(<Empty className="p-4">x</Empty>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("p-4");
    expect(el.className).not.toContain("p-12");
  });
});
