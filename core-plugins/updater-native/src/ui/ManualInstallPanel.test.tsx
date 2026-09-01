// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualInstallPanel } from "./ManualInstallPanel";

afterEach(cleanup);

function setup(
  overrides: Partial<Parameters<typeof ManualInstallPanel>[0]> = {},
) {
  const onSelectDistro = vi.fn();
  const onCopy = vi.fn();
  render(
    <ManualInstallPanel
      distro="arch"
      onSelectDistro={onSelectDistro}
      activeCommand="yay -S termco-bin"
      copied={false}
      onCopy={onCopy}
      {...overrides}
    />,
  );
  return { onSelectDistro, onCopy };
}

describe("ManualInstallPanel", () => {
  it("lists all three distro tabs", () => {
    setup();
    expect(screen.getByText("Arch")).toBeDefined();
    expect(screen.getByText("Debian / Ubuntu")).toBeDefined();
    expect(screen.getByText("Fedora / RHEL")).toBeDefined();
  });

  it("highlights the active distro tab", () => {
    setup({ distro: "debian" });
    expect(screen.getByText("Debian / Ubuntu").className).toContain(
      "bg-background",
    );
    expect(screen.getByText("Arch").className).not.toContain("bg-background");
  });

  it("lists all distro tabs and highlights the selected one", () => {
    setup({ distro: "debian" });
    expect(screen.getByText("Arch")).toBeDefined();
    expect(screen.getByText("Debian / Ubuntu").className).toContain(
      "bg-background",
    );
    expect(screen.getByText("Fedora / RHEL")).toBeDefined();
  });

  it("selects a distro on click", () => {
    const { onSelectDistro } = setup();
    fireEvent.click(screen.getByText("Fedora / RHEL"));
    expect(onSelectDistro).toHaveBeenCalledWith("fedora");
  });

  it("renders the install command with a shell prompt", () => {
    setup({ activeCommand: "sudo apt install ./Termco_1.0.0_amd64.deb" });
    expect(
      screen.getByText("$ sudo apt install ./Termco_1.0.0_amd64.deb"),
    ).toBeDefined();
  });

  it("invokes copy and reflects copied state", () => {
    const { onCopy } = setup();
    fireEvent.click(screen.getByText("Copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ copied: true });
    expect(screen.getByText("Copied")).toBeDefined();
  });

  it("copies the command and reflects the copied state", () => {
    const { onCopy } = setup();
    fireEvent.click(screen.getByText("Copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ copied: true });
    expect(screen.getByText("Copied")).toBeDefined();
  });
});
