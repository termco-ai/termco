import { describe, expect, it } from "vitest";
import { DISTROS, distroCommand, formatBytes } from "./distroCommand";

describe("distroCommand", () => {
  it("builds the arch command without a version", () => {
    expect(distroCommand("arch", "1.2.3")).toBe("yay -S termco-bin");
  });
  it("interpolates the version into the debian command", () => {
    expect(distroCommand("debian", "1.2.3")).toBe(
      "sudo apt install ./Termco_1.2.3_amd64.deb",
    );
  });
  it("interpolates the version into the fedora command", () => {
    expect(distroCommand("fedora", "1.2.3")).toBe(
      "sudo dnf install ./Termco-1.2.3-1.x86_64.rpm",
    );
  });
});

describe("DISTROS", () => {
  it("lists each distro key exactly once with a label", () => {
    const keys = DISTROS.map((distro) => distro.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(["arch", "debian", "fedora"]);
    for (const distro of DISTROS) {
      expect(distro.label.length).toBeGreaterThan(0);
    }
  });
});

describe("formatBytes", () => {
  it("formats bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });
  it("formats megabytes with one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5.25 * 1024 * 1024)).toBe("5.3 MB");
  });
});
