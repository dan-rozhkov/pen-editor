/**
 * Base stylesheet for plugin iframes, mirroring the visual recipe of the
 * app's own primitives (`src/components/ui/button.tsx`, `input.tsx`,
 * `select.tsx`, `textarea.tsx`, `checkbox.tsx`, `label.tsx`, plus badge,
 * card, separator, slider, tabs, inline-alert, table, field, IconButton,
 * button-group and input-group) so a plugin's markup can use `.pen-*`
 * classes instead of hand-rolled CSS and still match the editor's look in
 * both themes. Only primitives a static sandboxed iframe (no framework, no
 * Radix portals) can faithfully reproduce are covered — see
 * `docs/superpowers/specs/2026-07-21-plugin-ui-kit-expansion-design.md` for
 * the feasibility boundary (dropdown/dialog/popover/combobox/tooltip/toast
 * are deliberately out of scope).
 *
 * Colors are `var(--color-*)` (the `--color-*` family bootstrap.ts mirrors
 * into the iframe) plus the app's un-prefixed `--primary`/`--primary-foreground`,
 * `--secondary`/`--secondary-foreground` and `--input` tokens (`src/index.css`)
 * for the two recipes (Button's default variant, Input/Textarea, Select) that
 * are keyed off those rather than the `--color-*` family — all of them listed
 * in `THEME_CSS_VARS` (`bootstrap.ts`) so live theme changes (`themechange`)
 * restyle these classes for free. See `bootstrap.test.ts` / `uiKitStyles.test.ts`
 * for the guard that keeps this invariant. Radii/spacing are fixed constants:
 * they don't vary by theme, so there's no need to route them through the
 * theme payload.
 */
export const PLUGIN_UI_KIT_STYLES = `
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding: 12px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
}

.pen-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.pen-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pen-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.pen-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.1s, border-color 0.1s;
}

.pen-button:hover:not(:disabled) {
  background: var(--color-surface-active);
}

.pen-button:active:not(:disabled) {
  background: var(--color-surface-active);
  border-color: var(--color-border-hover);
}

.pen-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-accent-primary);
}

.pen-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pen-button-primary {
  background: var(--primary);
  border-color: var(--color-border-default);
  color: var(--primary-foreground);
}

/* Higher specificity than .pen-button:hover/:active (above) so the primary
   variant's own background/border survive interaction states — without
   this, the generic .pen-button hover/active rules win the
   background/border-color tie-break and the primary button turns grey. */
.pen-button.pen-button-primary:hover:not(:disabled) {
  background: color-mix(in oklab, var(--primary), var(--primary-foreground) 8%);
  border-color: var(--color-border-hover);
}

.pen-button.pen-button-primary:active:not(:disabled) {
  background: color-mix(in oklab, var(--primary), var(--primary-foreground) 14%);
  border-color: var(--color-border-hover);
}

.pen-input,
.pen-textarea {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: var(--secondary);
  color: var(--secondary-foreground);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: box-shadow 0.1s;
}

.pen-textarea {
  height: auto;
  min-height: 64px;
  padding: 6px 8px;
  resize: vertical;
}

.pen-input::placeholder,
.pen-textarea::placeholder {
  color: var(--color-text-muted);
}

.pen-input:focus-visible:not(:disabled),
.pen-textarea:focus-visible:not(:disabled) {
  box-shadow: 0 0 0 1px var(--color-accent-primary);
}

.pen-input:disabled,
.pen-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pen-select {
  height: 24px;
  padding: 0 26px 0 8px;
  border-radius: 6px;
  border: 1px solid var(--input);
  background-color: var(--color-surface-panel);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23666666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px 6px;
  color: var(--color-text-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: border-color 0.1s, box-shadow 0.1s;
}

[data-theme="dark"] .pen-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23999999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.pen-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
}

.pen-select:focus-visible:not(:disabled) {
  box-shadow: 0 0 0 1px var(--color-accent-primary);
}

.pen-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Native \`<input type="checkbox">\`, not a recreation of the app's custom
   Checkbox (\`checkbox.tsx\`, a styled div with its own checkmark icon) — a
   sandboxed plugin iframe can't ship that markup/JS, so this only matches
   size (16px, App's \`size-4\`) and accent color; the box shape, corner
   radius and checkmark glyph are the browser's native rendering and will
   differ slightly across platforms. */
.pen-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--color-accent-primary);
  cursor: pointer;
}

.pen-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pen-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

.pen-card {
  display: block;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-elevated);
  padding: 12px;
}

.pen-separator {
  height: 1px;
  border: none;
  background: var(--color-border-default);
}

/* Native \`<input type="range">\`, matching \`slider.tsx\`'s track/thumb tint
   the same way \`.pen-checkbox\` mirrors \`checkbox.tsx\` — the browser draws
   the actual track/thumb shape, \`accent-color\` only tints it. */
.pen-slider {
  width: 100%;
  height: 16px;
  accent-color: var(--color-accent-primary);
  cursor: pointer;
}

.pen-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* \`tabs.tsx\`'s default (non-"line"/"pill") variant: a \`secondary\`-tinted
   track holding flat, borderless triggers; the active trigger gets its own
   background/color via \`[aria-selected="true"]\`. There is no tabs runtime in
   the sandbox, so the plugin author sets that attribute on the active tab in
   their own markup (see the skill doc) — no JS state machine needed here. */
.pen-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--secondary);
}

.pen-tab {
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.1s, color 0.1s;
}

.pen-tab:hover:not([aria-selected="true"]) {
  color: var(--color-text-primary);
}

.pen-tab[aria-selected="true"] {
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
}

.pen-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  font-size: 12px;
}

.pen-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.pen-table th {
  text-align: left;
  padding: 6px 8px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-default);
}

.pen-table td {
  padding: 6px 8px;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-light);
}

.pen-table tr:last-child td {
  border-bottom: none;
}

.pen-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pen-help {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* Square 28×28 variant of \`.pen-button\` (\`IconButton.tsx\`'s size): apply
   alongside \`.pen-button\` (\`class="pen-button pen-icon-button"\`) — this
   only overrides the sizing/padding deltas, same pattern as
   \`.pen-button-primary\` layering onto \`.pen-button\`'s base rule. */
.pen-icon-button {
  width: 28px;
  padding: 0;
}

/* Joins adjacent \`.pen-button\`s into one row (\`button-group.tsx\`): flatten
   the shared edge, pull the border into a 1px overlap so adjacent buttons
   don't double it up, and keep only the group's outer corners rounded. */
.pen-button-group {
  display: inline-flex;
}

.pen-button-group .pen-button {
  border-radius: 0;
  margin-left: -1px;
}

.pen-button-group .pen-button:first-child {
  margin-left: 0;
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}

.pen-button-group .pen-button:last-child {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}

/* Without this, a hovered/focused button's 1px border overlap (above) can be
   drawn over by its neighbor since DOM order determines stacking. */
.pen-button-group .pen-button:hover:not(:disabled),
.pen-button-group .pen-button:focus-visible {
  position: relative;
  z-index: 1;
}

.pen-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--secondary);
  transition: box-shadow 0.1s;
}

.pen-input-group:focus-within {
  box-shadow: 0 0 0 1px var(--color-accent-primary);
}

.pen-input-group .pen-input {
  flex: 1;
  height: auto;
  padding: 0;
  background: transparent;
}

.pen-input-group .pen-input:focus-visible:not(:disabled) {
  box-shadow: none;
}

.pen-heading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.pen-muted {
  font-size: 12px;
  color: var(--color-text-muted);
}

.pen-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
}

.pen-link {
  color: var(--color-accent-primary);
  text-decoration: none;
  cursor: pointer;
}

.pen-link:hover {
  text-decoration: underline;
}
`;
