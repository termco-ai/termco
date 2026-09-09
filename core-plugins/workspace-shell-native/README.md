# Workspace Shell

Complete source owner for the established workspace composition: resizable
sidebar, retained tab surfaces, split panes, close dialogs, application
shortcuts, rig synchronization, and workspace presentation read models.

The plugin contributes the workspace through `ui.workspace.views@1` and uses
selected shared capability providers for tabs, rigs, terminal/editor sessions,
AI sessions, settings, shortcuts, and sidebar navigation.

Files and terminals can share the workspace vertically: right-click a file tab
and choose **Open Terminal Below**, or run **Open terminal below file** from the
command palette. The terminal starts in the file's directory. Drag the divider
to resize the two surfaces; the split direction is restored with the saved
workspace. Existing tabs can also be arranged using **Open Below** or
**Open to the Side** in the tab menu.

Drag a tab toward the left, right, top, or bottom edge of the workspace to snap
it into the highlighted half. The **Arrange tabs** button beside the new-tab
button offers the same four positions for the active tab. The divider remains
resizable, and the saved workspace restores both orientation and pane order.
Rearranging the panes preserves editor buffers, undo history, and terminal
sessions. Press Escape to cancel a drag.

Once panes are placed, drag either pane by its title bar to another workspace
edge to move it again. Its close button remains separate from the drag handle.
