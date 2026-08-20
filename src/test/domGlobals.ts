/**
 * Base UI's Slider Thumb (and some other native-input-shaped controls) reads
 * `event.target` off the ambient global `event` during its native `change`
 * handler — jsdom/happy-dom's `fireEvent.change` doesn't set that global
 * itself, so a test dispatching such a change must stub it for the duration
 * of the dispatch, then restore whatever was there before (or delete it, if
 * nothing was).
 *
 * Use as: stash the previous value, define the stub, fire the event, then
 * call `restoreGlobalEvent(previous)`. Kept as a helper (rather than an
 * inline `if (previous) {...} else {...}` in the test body) so it doesn't
 * trip eslint-plugin vitest's no-conditional-in-test — this is a real
 * restore-or-delete branch, not an assertion-narrowing guard.
 */
export function restoreGlobalEvent(previous: Event | undefined): void {
  if (previous) {
    Object.defineProperty(globalThis, "event", { configurable: true, value: previous });
  } else {
    delete (globalThis as { event?: Event }).event;
  }
}
