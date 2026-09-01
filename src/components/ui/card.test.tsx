// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

afterEach(cleanup);

describe("Card", () => {
  it("renders the full card composition with slot attributes", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
          <CardAction>Action</CardAction>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText("Title")).toHaveAttribute(
      "data-slot",
      "card-title",
    );
    expect(screen.getByText("Description")).toHaveAttribute(
      "data-slot",
      "card-description",
    );
    expect(screen.getByText("Action")).toHaveAttribute(
      "data-slot",
      "card-action",
    );
    expect(screen.getByText("Content")).toHaveAttribute(
      "data-slot",
      "card-content",
    );
    expect(screen.getByText("Footer")).toHaveAttribute(
      "data-slot",
      "card-footer",
    );
  });

  it("defaults to the default size and supports sm", () => {
    const { container, rerender } = render(<Card>x</Card>);
    let card = container.firstElementChild as HTMLElement;
    expect(card).toHaveAttribute("data-size", "default");
    rerender(<Card size="sm">x</Card>);
    card = container.firstElementChild as HTMLElement;
    expect(card).toHaveAttribute("data-size", "sm");
  });

  it("merges custom classes on the root", () => {
    const { container } = render(<Card className="p-0">x</Card>);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "p-0",
    );
  });
});
