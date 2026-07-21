# Move Plugins from modal → left sidebar panel

**Date:** 2026-07-21
**Status:** Approved (autonomous goal)

## Goal

Move the installed-plugins manager UI out of the `PluginManagerPanel` modal
dialog and into a dedicated left-sidebar section. Add a **Toolbox** icon to the
left rail directly under the existing **Assets** entry, titled "Plugins".

## Current state

- `PluginManagerPanel.tsx` renders a Radix-style `<Dialog>` listing installed
  plugins (Run / View-code / Export / Delete / Import). Opened via the
  "Manage plugins…" command-palette entry, which calls
  `usePluginManagerStore.setOpen(true)`.
- Mounted once at `App.tsx` (`{mode === "edit" && <PluginManagerPanel />}`).
- Left rail (`LeftRail.tsx`) has `SECTIONS` and `STYLE_SECTIONS` arrays; the
  active section id lives in `leftSidebarStore.ts` (`LeftSection` union +
  `LEFT_SECTIONS` array, persisted to localStorage).
- Left panel body (`LeftSidebar.tsx`) switches rendered content on
  `activeSection === "…"`.

## Changes

1. **`leftSidebarStore.ts`** — add `"toolbox"` to the `LeftSection` union and to
   the `LEFT_SECTIONS` array (keeps localStorage-restore validation working).

2. **`LeftRail.tsx`** — import `ToolboxIcon` from `@phosphor-icons/react`; add
   `{ section: "toolbox", testid: "rail-toolbox", title: "Plugins",
   icon: <ToolboxIcon size={20} weight="light" /> }` to `SECTIONS` immediately
   after the `"components"` (Assets) entry.

3. **New `PluginsPanel.tsx`** — move the plugin-list body out of
   `PluginManagerPanel`'s outer `<Dialog>` into an inline panel component. It
   keeps the empty state, the per-plugin row (Run / View-code / Export /
   Delete), the Import button, its local `activeDialog` state, and the two
   nested modal sub-actions ("view code" `Dialog`, delete `AlertDialog`) — those
   are legitimate modal sub-flows and stay. Only the *outer* container dialog is
   replaced by an inline flex column that fills the panel body.

4. **`LeftSidebar.tsx`** — add a titled "Plugins" header block (mirroring the
   `components` header) and a `activeSection === "toolbox"` render block
   (`absolute inset-0 flex flex-col overflow-hidden` → `<PluginsPanel />`).

5. **`pluginCommands.ts`** — "Manage plugins…" now calls
   `useLeftSidebarStore.getState().setActiveSection("toolbox")` (and
   `setPanelOpen(true)` for the mobile overlay) instead of opening the dialog.

6. **Cleanup** — delete `PluginManagerPanel.tsx`, `pluginManagerStore.ts`, and
   the `PluginManagerPanel` mount in `App.tsx`. Update/rename the corresponding
   tests: `PluginManagerPanel.test.tsx` → `PluginsPanel.test.tsx` (render the
   inline panel directly, drop the `open` gating), and `pluginCommands.test.ts`
   (assert the command sets the active section instead of the dialog open flag).

## Out of scope

- The floating running-plugin windows (`PluginPanels.tsx` / `pluginPanelStore`)
  are untouched — they are a different feature (a running plugin's own iframe
  UI), not the manager list.

## Testing / verification

- `npm run lint`, `npm test`, `npm run build` must pass.
- Live-verify in browser: rail shows a Toolbox "Plugins" icon under Assets;
  clicking it shows the plugin list in the left panel; "Manage plugins…" from
  the command palette navigates to it; View-code / Delete sub-dialogs still work.
