# Offline cloud indicator next to the filename

**Date:** 2026-07-21
**Status:** approved-pending-review

## Problem

When the browser has no network connection, the app already shows a global
`OfflineBanner` pill and disables AI/backend actions, but nothing next to the
**document name** signals that the document is currently offline / local-only.
The goal: show a crossed-out cloud icon (Phosphor `CloudSlash`) with a tooltip,
right beside the filename, whenever there is no internet.

## Key constraint discovered

There is **no cloud document sync** in this codebase. `.pen` files are saved via
browser download and opened via a file input (`src/lib/commands/fileCommands.ts`);
there is no autosave, no sync endpoint, no persisted "offline document" flag.
`documentStore` holds only `fileName`.

Therefore "нет интернета" and "документ в офлайн режиме" are **the same real
condition**: `navigator.onLine === false`. We derive the indicator from the
existing `useOnlineStatus()` hook and introduce no new state. (If real cloud
sync is added later, this indicator can be re-pointed at a richer sync-state
signal without moving it.)

## Design

### Placement

The filename is rendered as an `EditableText` in the pages/slides document
header of `src/components/LeftSidebar.tsx` (currently lines ~70–79), shown only
when `activeSection` is `"pages"` or `"slides"`.

Wrap the existing `EditableText` and the new icon in a flex row. The
`EditableText` keeps `flex-1 min-w-0` so it still truncates; the icon sits to
its **right** with `shrink-0` so it is never squeezed and never shifts the name.

```tsx
<div className="px-2 pb-2">
  <div className="flex items-center gap-1">
    <EditableText
      value={displayName}
      onCommit={(name) => setFileName(name + extension)}
      className="flex-1 min-w-0 h-7 px-1 rounded truncate text-sm font-medium text-text-default cursor-text hover:bg-secondary flex items-center"
      inputClassName="w-full h-7 px-1 py-0.5 rounded text-sm font-medium text-text-default bg-secondary outline-none"
    />
    {!isOnline && <OfflineDocumentIndicator />}
  </div>
</div>
```

(The `flex-1 min-w-0` classes move from being implicit-full-width onto the
`EditableText` itself so the row shares width correctly.)

### The indicator

Rendered inline in `LeftSidebar.tsx` (small enough not to warrant its own file;
kept as a local element, not a new component, per YAGNI):

```tsx
<Tooltip>
  <TooltipTrigger
    render={
      <span
        role="img"
        aria-label={OFFLINE_DOCUMENT_TITLE}
        className="shrink-0 flex items-center text-text-muted"
      >
        <CloudSlash size={14} />
      </span>
    }
  />
  <TooltipContent side="bottom">{OFFLINE_DOCUMENT_TITLE}</TooltipContent>
</Tooltip>
```

- `CloudSlash` imported from `@phosphor-icons/react` (confirmed present in the
  installed `^2.1.10`).
- `Tooltip`/`TooltipTrigger`/`TooltipContent` from `@/components/ui/tooltip`.
  The single app-level `TooltipProvider` (`App.tsx`) already covers it — do not
  nest another.
- Uses a non-interactive `<span>` trigger with `role="img"` + `aria-label` so it
  is discoverable to assistive tech without being a focus target.

### Copy

Add one canonical string next to the existing offline copy in
`src/lib/apiBase.ts`, matching the terse English tone of `OFFLINE_MESSAGE` /
`OFFLINE_SEND_TITLE`:

```ts
export const OFFLINE_DOCUMENT_TITLE = "Offline — document is available locally only";
```

`LeftSidebar.tsx` imports it; both the tooltip text and the `aria-label` use it,
so they never drift.

### Data flow

```
navigator.onLine / online|offline events
        │
        ▼
useOnlineStatus()  ──►  isOnline (boolean)  ──►  LeftSidebar renders indicator when !isOnline
```

No store, no effect, no persisted flag. The hook already re-renders on
online/offline events.

## Error handling / edge cases

- **Section gating:** the filename header only renders for `pages`/`slides`
  sections, so the indicator inherits that — acceptable; the global
  `OfflineBanner` still covers other sections.
- **Long filenames:** icon is `shrink-0`, name truncates first. Verified by the
  flex layout.
- **Coming back online:** `useOnlineStatus` flips `isOnline` to `true` on the
  `online` event, the indicator unmounts. No manual teardown.

## Testing

Extend `src/components/__tests__/LeftSidebar.test.tsx`:

1. With `navigator.onLine === true` and `activeSection` = `pages`, the indicator
   (query by its `aria-label` / `OFFLINE_DOCUMENT_TITLE`) is **absent**.
2. With `navigator.onLine === false`, it is **present**.

Toggle `navigator.onLine` and dispatch `online`/`offline` events using the same
approach as `src/hooks/__tests__/useOnlineStatus.test.ts`. Tooltip open-on-hover
is Base UI's behavior and not re-tested here; asserting the accessible label is
enough to prove the indicator renders with correct copy.

## Out of scope (YAGNI)

- No new Zustand store or persisted "offline document" flag.
- No per-document manual "work offline" toggle.
- No change to the existing `OfflineBanner` or chat send-disable behavior.
- No cloud-sync plumbing.

## Version / release

Frontend-only change (`pen-editor`). Bump a minor version and release per the
`ship-release` skill after the user verifies in the browser.
