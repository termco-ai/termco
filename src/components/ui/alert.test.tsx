// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";

afterEach(cleanup);

describe("Alert", () => {
  it("renders an alert role with title, description and action", () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something happened</AlertDescription>
        <AlertAction>Undo</AlertAction>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-slot", "alert");
    expect(screen.getByText("Heads up")).toHaveAttribute(
      "data-slot",
      "alert-title",
    );
    expect(screen.getByText("Something happened")).toHaveAttribute(
      "data-slot",
      "alert-description",
    );
    expect(screen.getByText("Undo")).toHaveAttribute(
      "data-slot",
      "alert-action",
    );
  });

  it("applies the default variant styling", () => {
    render(<Alert>x</Alert>);
    expect(screen.getByRole("alert").className).toContain(
      "text-card-foreground",
    );
  });

  it("applies the destructive variant styling", () => {
    render(<Alert variant="destructive">x</Alert>);
    expect(screen.getByRole("alert").className).toContain("text-destructive");
  });

  it("merges custom classes", () => {
    render(<Alert className="border-0">x</Alert>);
    expect(screen.getByRole("alert").className).toContain("border-0");
  });
});
