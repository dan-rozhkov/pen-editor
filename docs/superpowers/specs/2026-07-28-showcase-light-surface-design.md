# Showcase light surface

## Goal

Make the public showcase gallery use a light presentation and allow its masonry grid to use the full desktop viewport width.

## Design

- The showcase page root uses an explicit white background (`bg-white`) so it remains white independently of editor theme tokens.
- Each screenshot card gets a one-pixel light-gray border (`border border-gray-200`). The existing rounding, clipping, aspect ratio, and image behavior stay unchanged.
- The header and main gallery containers keep their current `max-w-6xl` constraint below the desktop breakpoint and override it with `lg:max-w-none` on desktop. Existing horizontal padding remains in place.
- Loading, empty, error, pagination, and card interaction behavior do not change.

## Verification

- Component tests assert the white page background, screenshot border, and desktop max-width override.
- The focused showcase test suite passes.
- The production build succeeds.

