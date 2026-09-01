// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "./tabs";

afterEach(cleanup);

function renderTabs(listVariant?: "default" | "line") {
  return render(
    <Tabs defaultValue="one">
      <TabsList variant={listVariant}>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">first panel</TabsContent>
      <TabsContent value="two">second panel</TabsContent>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("shows the default tab and switches on click", () => {
    renderTabs();
    expect(screen.getByText("first panel")).toBeInTheDocument();
    expect(screen.queryByText("second panel")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Two"), { button: 0 });
    fireEvent.click(screen.getByText("Two"));
    expect(screen.getByText("second panel")).toBeInTheDocument();
    expect(screen.queryByText("first panel")).not.toBeInTheDocument();
  });

  it("marks the active trigger", () => {
    renderTabs();
    expect(screen.getByText("One")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Two")).toHaveAttribute("data-state", "inactive");
  });

  it("defaults to horizontal orientation with the default list variant", () => {
    renderTabs();
    expect(screen.getByRole("tablist").parentElement).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-variant", "default");
    expect(list.className).toContain("bg-muted");
  });

  it("applies the line list variant", () => {
    renderTabs("line");
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-variant", "line");
    expect(list.className).toContain("bg-transparent");
  });

  it("exposes tabsListVariants", () => {
    expect(tabsListVariants({ variant: "line" })).toContain("bg-transparent");
  });
});
