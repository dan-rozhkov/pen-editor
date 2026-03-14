import { TextStyle } from "pixi.js";

export const SELECTION_COLOR = 0x0d99ff;
export const HOVER_COLOR = 0x0d99ff;
export const COMPONENT_SELECTION_COLOR = 0x8b5cf6;
export const TEXT_BASELINE_COLOR = 0x0d99ff;
export const HANDLE_SIZE = 8;
export const HANDLE_FILL = 0xffffff;
export const GAP_COLOR = 0xff44b4;
export const PADDING_OVERLAY_ALPHA = 0.08;
export const GAP_OVERLAY_ALPHA = 0.08;
export const HATCH_SPACING = 6;

// Floating label constants (shared by measure lines, spacing overlays, etc.)
export const FLOATING_LABEL_FONT_SIZE = 11;
export const FLOATING_LABEL_PADDING_X = 4;
export const FLOATING_LABEL_PADDING_Y = 2;
export const FLOATING_LABEL_RADIUS = 2;
export const FLOATING_LABEL_STYLE = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: FLOATING_LABEL_FONT_SIZE,
  fill: "#ffffff",
});

// Frame name label constants
export const LABEL_FONT_SIZE = 11;
export const LABEL_OFFSET_Y = 4;
export const LABEL_COLOR_NORMAL = "#666666";
export const LABEL_COLOR_SELECTED = "#0d99ff";
export const LABEL_COLOR_COMPONENT = "#9747ff";

// Size label constants
export const SIZE_LABEL_FONT_SIZE = 11;
export const SIZE_LABEL_OFFSET_Y = 6;
export const SIZE_LABEL_PADDING_X = 6;
export const SIZE_LABEL_PADDING_Y = 3;
export const SIZE_LABEL_CORNER_RADIUS = 3;
export const SIZE_LABEL_BG_DEFAULT = 0x0d99ff;
export const SIZE_LABEL_BG_COMPONENT = 0x9747ff;
export const SIZE_LABEL_TEXT_COLOR = "#ffffff";

export const SIZE_LABEL_STYLE = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: SIZE_LABEL_FONT_SIZE,
  fill: SIZE_LABEL_TEXT_COLOR,
});

export const FRAME_NAME_STYLE_NORMAL = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_NORMAL,
});

export const FRAME_NAME_STYLE_SELECTED = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_SELECTED,
});

export const FRAME_NAME_STYLE_COMPONENT = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_COMPONENT,
});
