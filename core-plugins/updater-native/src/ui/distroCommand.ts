export type DistroKey = "arch" | "debian" | "fedora";

export function distroCommand(key: DistroKey, version: string): string {
  switch (key) {
    case "arch":
      return "yay -S termco-bin";
    case "debian":
      return `sudo apt install ./Termco_${version}_amd64.deb`;
    case "fedora":
      return `sudo dnf install ./Termco-${version}-1.x86_64.rpm`;
  }
}

export const DISTROS: { key: DistroKey; label: string }[] = [
  { key: "arch", label: "Arch" },
  { key: "debian", label: "Debian / Ubuntu" },
  { key: "fedora", label: "Fedora / RHEL" },
];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
