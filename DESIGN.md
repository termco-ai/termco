---
name: Termco 2.0
description: A calm, compact terminal workspace with persistent navigation, quiet graphite structure, and a restrained iris interaction signal.
colors:
  canvas-light: "oklch(0.976 0.003 275)"
  surface-light: "oklch(0.995 0.001 275)"
  chrome-light: "oklch(0.955 0.006 275)"
  ink: "oklch(0.19 0.012 270)"
  canvas-dark: "oklch(0.155 0.012 270)"
  surface-dark: "oklch(0.195 0.014 270)"
  chrome-dark: "oklch(0.17 0.012 270)"
  paper: "oklch(0.925 0.008 275)"
  muted: "oklch(0.49 0.018 270)"
  iris: "oklch(0.57 0.19 274)"
  iris-light: "oklch(0.72 0.16 274)"
  healthy: "oklch(0.72 0.17 150)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.2
  title:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "0"
  code:
    fontFamily: "JetBrains Mono, Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  compact: "4px"
  control: "6px"
  card: "8px"
  overlay: "12px"
spacing:
  contact: "4px"
  compact: "8px"
  control: "12px"
  section: "16px"
  field: "24px"
components:
  button-primary:
    backgroundColor: "{colors.iris}"
    textColor: "{colors.surface-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "36px"
  panel:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "{spacing.section}"
  status-row:
    backgroundColor: "{colors.chrome-light}"
    textColor: "{colors.muted}"
    typography: "{typography.code}"
    height: "28px"
---

# Design System: Termco 2.0

## Overview

**Creative North Star: “Quiet Studio”**

Termco 2.0 is a focused desktop workspace for terminals, code, and agents. The redesign should feel new through stronger hierarchy, calmer density, and a coherent visual system—not through a loud theme. The terminal or editor is always the dominant surface. Navigation stays available but recedes once a destination is chosen.

This direction takes cues from contemporary productivity tools that reduce icon size, dim supporting navigation, and let alignment provide structure. It deliberately rejects the discarded patchbay concept: no orange chrome, black rack frame, giant tool keys, condensed equipment labels, or heavy seams.

**Key Characteristics:**

- Persistent vertical workspace menu with compact 32px targets.
- Neutral graphite/ink surfaces in both themes.
- Iris used sparingly for focus, selection, and primary actions.
- Compact title bar, tabs, buttons, and status row.
- Sentence-case labels in Geist; mono only for technical content.
- Soft one-pixel separators, subtle shadows, and moderate radii.
- Centered dialogs and quiet side sheets with clear action hierarchy.

## Colors

The palette is intentionally low-chroma. Light mode uses cool off-white canvases and white surfaces. Dark mode uses layered graphite rather than pure black.

- **Iris** (`oklch(0.57 0.19 274)` light / `oklch(0.72 0.16 274)` dark): focus rings, selected navigation tint, links, and primary actions.
- **Canvas:** the lowest work surface; terminal/editor content occupies it directly.
- **Surface:** cards, fields, and transient overlays.
- **Chrome:** title bar, sidebar, tab rail, and status row; one small tonal step away from the canvas.
- **Healthy:** tiny green status dots only.
- **Destructive:** errors and destructive confirmations only.

**The Earned Attention Rule.** Supporting navigation is muted. Full-strength iris is reserved for an action the user can take now; selected navigation uses a translucent tint rather than a solid block.

## Typography

**UI Font:** Geist Variable
**Technical Font:** JetBrains Mono, with Geist Mono fallback

- **Display:** 18px / 650 for rare full-window identities.
- **Title:** 16px / 600 for panel and dialog titles.
- **Body:** 14px / 400 for descriptions, messages, and settings.
- **Label:** 12px / 550 for compact controls and navigation.
- **Code:** 12px / 400 for commands, paths, source, shortcuts, and measured values.

Sentence case is the default. Uppercase is limited to short group labels where it improves scanning. Buttons never force uppercase.

## Layout

The desktop shell uses a 44px title bar, 36px tab row, flexible work area, and 28px status row. The left workspace region contains a persistent 48px vertical tool menu beside its resizable content panel. The menu must never be replaced by a horizontal deck.

The center workspace remains the largest uninterrupted region. The optional AI dock stays resizable on the right. Settings and Agents use a compact 240px navigation column and a readable content column. At narrow widths, their navigation becomes a horizontal scroller while the main shell keeps the tool menu available whenever space permits.

Spacing follows a 4/8/12/16/24px rhythm. Dense toolbars use 4–8px gaps; forms and descriptive sections use 12–24px.

## Elevation & Depth

Structure should be felt more than seen. Persistent regions use one-pixel separators and tonal changes, never thick black outlines. Cards use a one-pixel border plus a nearly imperceptible 1px shadow. Menus and dialogs use one soft ambient shadow. No offset block shadows, glow, glass panels, or decorative gradients.

## Shapes

- Tiny utility controls and code tags: 4px.
- Buttons, tabs, and fields: 6px.
- Cards and menu surfaces: 8px.
- Dialogs: 12px.
- Pills are reserved for status or compact taxonomy.
- Circles are reserved for status dots, radio controls, avatars, and true icon badges.

## Components

### Buttons

Default height is 32px, small is 28px, and icon controls match those sizes. Primary buttons use solid iris; secondary buttons use a neutral surface and border; ghost buttons reveal only a quiet hover tint. Focus uses a two-pixel translucent iris ring.

### Navigation

The persistent tool menu is vertical and icon-led, with tooltips and accessible labels. The selected tool uses iris text, a pale iris background, and a narrow left marker. Settings and Agents use icon-plus-label rows with the same selection treatment.

### Cards and Lists

Prefer divided lists for dense repeated data. Use cards only when an item needs its own actions, status, or grouped content. Cards use 8px corners, one-pixel borders, and compact 12–16px padding.

### Inputs

Fields are 36px high, white/graphite, one-pixel bordered, and 6px rounded. Hover slightly strengthens the border. Focus adds an iris border and translucent ring. Labels stay visible above fields.

### Dialogs and Menus

Dialogs center within the work area, cap their height, and use a 12px radius. Headers contain a clear title and short description; actions sit in a separated footer. Menus use 8px corners and neutral selected rows. Menus do not turn every hovered row into a solid primary-colored block.

### Browsers and Selectors

Use a searchable browser when the choice has providers, metadata, setup state, favorites, or history. Model selection uses an explicit “Ready to use” / “All models” scope so users always understand whether they are seeing connected choices or the full provider catalogue. It promotes the current, saved, and recent choices within that scope. Keep comparison metadata in concise descriptions or hover detail rather than displaying every signal at once. Small finite choices can remain native selects.

Provider setup starts with the source type—cloud, local runtime, or compatible endpoint—then asks for credentials or connection details. Connection state must be visible before a user enters the flow.

### Chat and Agent Work

Chat reads as a work transcript, not a stream of decorative bubbles. User requests are full-width request cards; assistant responses use a quiet timeline rail, role identity, and stable action margin. Tool calls and approvals are reviewable work records with explicit state and action hierarchy.

The composer is a docked command surface. Attachments, model selection, reasoning controls, and send/stop remain compact and visually subordinate to the prompt.

### Purpose-built Overlays

Transient surfaces explain the object being chosen. Session, agent, workspace, branch, port, file, snippet, and language overlays include useful state or descriptions rather than presenting anonymous icon rows. Repeated rows stay dense; overlay headers provide context; destructive actions never masquerade as ordinary navigation.

### Terminal and Editor

Terminal content uses an 8px horizontal inset so prompts and output do not touch the workspace sides while the canvas retains the full available height. It remains borderless, shadowless, and functionally unchanged; the measured terminal canvas itself receives no padding. Editor, diff, preview, and markdown content remain visually flush and functionally unchanged. Their surrounding chrome supplies context without overlaying or decorating user content.

## Do’s and Don’ts

### Do

- Keep the vertical tool menu persistent and recognizable.
- Keep buttons compact and sentence case.
- Use iris as a signal, not a background theme.
- Let navigation recede and work content dominate.
- Preserve every feature, shortcut, resizer, menu item, and workflow.
- Verify both themes and narrow layouts.

### Don’t

- Don’t use orange UI chrome or a black hardware frame.
- Don’t use giant labeled tool buttons or a horizontal primary menu.
- Don’t use thick black borders, offset shadows, or condensed all-caps labels.
- Don’t make selected navigation a large saturated block.
- Don’t turn every region into a floating card.

## Product presentation extension

The standalone sales surface in `docs/product-presentation/` uses the same Quiet Studio palette, Geist Variable/JetBrains Mono typography, iris attention rule, and low-chroma structure at editorial scale. Large display type may range from 36–92px so a browser presentation can communicate hierarchy before it shows the compact application UI. Full-width 16:10 film and screenshot frames may use 12–16px radii and soft ambient shadows; these larger frames are media stages, not application panels. Their contents must use `object-fit: contain`, preserve the complete current-build frame at every breakpoint, and provide explicit native full-screen access.

Presentation-only tonal values may interpolate the documented graphite, canvas, iris, and healthy colors for translucent borders, shadows, dark-section contrast, and selected-state tints. They must not introduce a new hue family or change the in-product component palette.
