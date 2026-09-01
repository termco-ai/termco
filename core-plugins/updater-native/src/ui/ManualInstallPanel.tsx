import ui from "@termco/ui";
import { DISTROS, type DistroKey } from "./distroCommand";

type Props = {
  distro: DistroKey;
  onSelectDistro: (key: DistroKey) => void;
  activeCommand: string;
  copied: boolean;
  onCopy: () => void;
};

export function ManualInstallPanel({
  distro,
  onSelectDistro,
  activeCommand,
  copied,
  onCopy,
}: Props) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex gap-1 rounded-md bg-muted/40 p-1">
        {DISTROS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            onClick={() => onSelectDistro(candidate.key)}
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
              distro === candidate.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs">
        <span className="flex-1 select-all">$ {activeCommand}</span>
        <ui.Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCopy}
        >
          {copied ? "Copied" : "Copy"}
        </ui.Button>
      </div>
    </div>
  );
}
