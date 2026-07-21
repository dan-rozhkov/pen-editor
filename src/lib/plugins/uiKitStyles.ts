/**
 * Base stylesheet for plugin iframes, mirroring the visual recipe of the
 * app's own primitives (`src/components/ui/button.tsx`, `input.tsx`,
 * `select.tsx`, `textarea.tsx`, `checkbox.tsx`, `label.tsx`) so a plugin's
 * markup can use `.pen-*` classes instead of hand-rolled CSS and still match
 * the editor's look in both themes.
 *
 * Every color is `var(--color-*)`, restricted to the tokens `bootstrap.ts`
 * (`THEME_CSS_VARS`) actually mirrors into the iframe, so live theme changes
 * (`themechange`) restyle these classes for free — see
 * `bootstrap.test.ts` / `uiKitStyles.test.ts` for the guard that keeps this
 * invariant. Radii/spacing are fixed constants: they don't vary by theme, so
 * there's no need to route them through the theme payload.
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
  background: var(--color-accent-primary);
  border-color: var(--color-accent-primary);
  color: #ffffff;
}

.pen-button-primary:hover:not(:disabled) {
  opacity: 0.85;
}

.pen-button-primary:active:not(:disabled) {
  opacity: 0.7;
}

.pen-input,
.pen-textarea,
.pen-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 0.1s;
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

.pen-input:hover:not(:disabled),
.pen-textarea:hover:not(:disabled),
.pen-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
}

.pen-input:focus-visible,
.pen-textarea:focus-visible,
.pen-select:focus-visible {
  border-color: var(--color-accent-primary);
  box-shadow: 0 0 0 1px var(--color-accent-primary);
}

.pen-input:disabled,
.pen-textarea:disabled,
.pen-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pen-select {
  cursor: pointer;
}

.pen-checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--color-accent-primary);
  cursor: pointer;
}

.pen-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;
