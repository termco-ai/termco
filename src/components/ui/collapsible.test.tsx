// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";

afterEach(cleanup);

describe("Collapsible", () => {
  it("hides content until the trigger is clicked", () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>toggle</CollapsibleTrigger>
        <CollapsibleContent>hidden body</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.queryByText("hidden body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByText("hidden body")).toBeInTheDocument();
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.queryByText("hidden body")).not.toBeInTheDocument();
  });

  it("supports defaultOpen and slot attributes", () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>toggle</CollapsibleTrigger>
        <CollapsibleContent>visible body</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByText("toggle");
    expect(trigger).toHaveAttribute("data-slot", "collapsible-trigger");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(screen.getByText("visible body")).toHaveAttribute(
      "data-slot",
      "collapsible-content",
    );
  });
});
