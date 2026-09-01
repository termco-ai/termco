/**
 * Terminal theming for the wterm engine: design tokens map onto the
 * CSS custom properties the DOM renderer consumes (`--term-color-N`,
 * `--term-fg`, `--term-bg`) plus app-defined cursor/selection vars used
 * by globals.css. Theme switches recolor existing content live because
 * indexed colors render as `var()` references.
 *
 * The vars must be written INLINE on each slot's host element, not only
 * on :root: the host carries the library's `.wterm` class, which itself
 * declares default values for these vars and would shadow anything
 * inherited from the root.
 */
import { readTerminalTokens } from "@/styles/tokens";

/**
 * Resolved palette colors for non-terminal consumers (the blocks
 * shell-input editor) that need concrete values instead of CSS vars.
 * Field names keep the xterm ITheme vocabulary they were written for.
 */
export function terminalPalette() {
  const t = readTerminalTokens();
  return {
    foreground: t.foreground,
    background: t.background,
    cursor: t.cursor,
    selectionBackground: t.selection,
    blue: t.ansiBlue,
    cyan: t.ansiCyan,
    green: t.ansiGreen,
    magenta: t.ansiMagenta,
    yellow: t.ansiYellow,
    brightBlack: t.ansiBrightBlack,
  };
}

export function applyTerminalCssTheme(host?: HTMLElement): void {
  const t = readTerminalTokens();
  const target = host?.style ?? document.documentElement.style;
  const ansi = [
    t.ansiBlack,
    t.ansiRed,
    t.ansiGreen,
    t.ansiYellow,
    t.ansiBlue,
    t.ansiMagenta,
    t.ansiCyan,
    t.ansiWhite,
    t.ansiBrightBlack,
    t.ansiBrightRed,
    t.ansiBrightGreen,
    t.ansiBrightYellow,
    t.ansiBrightBlue,
    t.ansiBrightMagenta,
    t.ansiBrightCyan,
    t.ansiBrightWhite,
  ];
  ansi.forEach((color, i) => {
    target.setProperty(`--term-color-${i}`, color);
  });
  target.setProperty("--term-fg", t.foreground);
  target.setProperty("--term-bg", t.background);
  target.setProperty("--term-cursor", t.cursor);
  target.setProperty("--term-cursor-accent", t.cursorAccent);
  target.setProperty("--term-selection", t.selection);
}
