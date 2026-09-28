/**
 * The accent shared by the dashed Pixi placeholder box and the DOM streaming
 * preview's writing head. Neutral module (no pixi.js) so DOM components can
 * import it; the number and CSS forms derive from one value.
 */
export const PLACEHOLDER_COLOR = 0x0d99ff;
export const PLACEHOLDER_COLOR_CSS = `#${PLACEHOLDER_COLOR.toString(16).padStart(6, "0")}`;
