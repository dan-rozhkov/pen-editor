# Showcase themed surface

## Goal

Make the public showcase gallery follow the editor's persisted light/dark preference and allow its masonry grid to use the full desktop viewport width.

## Design

- The showcase page root uses the panel surface token (`bg-surface-panel`) so it follows the persisted editor theme.
- Each screenshot card gets a one-pixel themed hairline (`inset-ring-border-default`). The existing rounding, clipping, aspect ratio, and image behavior stay unchanged.
- The header and main gallery containers keep their current `max-w-6xl` constraint below the desktop breakpoint and override it with `lg:max-w-none` on desktop. Existing horizontal padding remains in place.
- Loading, empty, error, pagination, and card interaction behavior do not change.

## Verification

- Component tests assert the themed page background, screenshot border, and desktop max-width override.
- The focused showcase test suite passes.
- The production build succeeds.
