// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";

afterEach(cleanup);

describe("Breadcrumb", () => {
  it("renders an accessible breadcrumb trail", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/home">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAttribute("aria-label", "breadcrumb");
    expect(screen.getByText("Home")).toHaveAttribute("href", "/home");
    const page = screen.getByText("Current");
    expect(page).toHaveAttribute("aria-current", "page");
    expect(page).toHaveAttribute("aria-disabled", "true");
  });

  it("renders the link child when asChild is set", () => {
    render(
      <BreadcrumbLink asChild>
        <button type="button">go</button>
      </BreadcrumbLink>,
    );
    const el = screen.getByText("go");
    expect(el.tagName).toBe("BUTTON");
    expect(el).toHaveAttribute("data-slot", "breadcrumb-link");
  });

  it("renders a default separator icon that is aria-hidden", () => {
    const { container } = render(<BreadcrumbSeparator />);
    const li = container.querySelector(
      "[data-slot=breadcrumb-separator]",
    ) as HTMLElement;
    expect(li).toHaveAttribute("aria-hidden", "true");
    expect(li.querySelector("svg")).not.toBeNull();
  });

  it("renders custom separator children", () => {
    render(<BreadcrumbSeparator>/</BreadcrumbSeparator>);
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("renders an ellipsis with a screen-reader label", () => {
    render(<BreadcrumbEllipsis />);
    expect(screen.getByText("More")).toHaveClass("sr-only");
  });
});
