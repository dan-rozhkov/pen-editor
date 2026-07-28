# Restore Mobile Showcase Screen Size

## Goal

Keep the recently reduced outer gutters of the mobile showcase while restoring
the app screenshot width that existed before that change.

## Design

The outer mobile page padding remains `1rem` on each side. The horizontal
padding inside each grey showcase app panel increases from `3rem` to `5rem` on
each side below the `sm` breakpoint.

This exactly compensates for the outer gutter reduction:

- Before: `3rem` outer + `3rem` inner on each side.
- Current: `1rem` outer + `3rem` inner on each side.
- Proposed: `1rem` outer + `5rem` inner on each side.

The total horizontal space surrounding a screenshot returns to `12rem`, so the
screens regain their previous rendered width. At `sm` and above, the existing
`4rem` inner and outer padding remains unchanged.

## Scope

Only the base horizontal padding on the native scroll-snap list in
`ShowcaseAppCarousel` changes. Vertical panel padding, panel dimensions,
carousel behavior, safe-area handling, and tablet/desktop layout remain
unchanged.

## Verification

- Add a component regression assertion for `px-20 sm:px-16` on the carousel
  scroller.
- Run the focused component test.
- Run the frontend build.
- Inspect the mobile showcase at a viewport below 640 px and confirm that the
  screenshots match their pre-gutter-change width while the page gutters stay
  compact.
