import { createIcon } from "../createIcon";

// Design tools: drawing, editing, colour, boolean operations, transforms.

/** Rounded-rect path, used where boolean ops need two shapes in one `d`. */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}Z`;

/** Circle as a closed path (for evenodd holes). */
const hole = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0-${2 * r} 0Z`;

// Two overlapping squares shared by the boolean-op glyphs.
const SQ_A = rr(2.5, 2.5, 8, 8, 1.5);
const SQ_B = rr(5.5, 5.5, 8, 8, 1.5);

const PALETTE_BODY =
  "M8 2a6 6 0 1 0 0 12c1.1 0 1.6-.7 1.6-1.4 0-.9-.6-1.1-.6-1.9 0-.8.6-1.1 1.4-1.1H12a2 2 0 0 0 2-2C14 4.2 11.3 2 8 2Z";

export const PencilSimpleIcon = /*#__PURE__*/ createIcon(
  "PencilSimple",
  <path d="M2.75 13.25 3.3 10.6l7.4-7.4a1.25 1.25 0 0 1 1.77 0l.33.33a1.25 1.25 0 0 1 0 1.77l-7.4 7.4-2.65.55ZM9.5 4.5l2 2" />,
);

export const PencilSimpleLineIcon = /*#__PURE__*/ createIcon(
  "PencilSimpleLine",
  <>
    <path
      transform="translate(.3 -.4) scale(.9)"
      d="M2.75 13.25 3.3 10.6l7.4-7.4a1.25 1.25 0 0 1 1.77 0l.33.33a1.25 1.25 0 0 1 0 1.77l-7.4 7.4-2.65.55ZM9.5 4.5l2 2"
    />
    <path d="M8.5 13.5h5" />
  </>,
);

export const PencilLineIcon = /*#__PURE__*/ createIcon(
  "PencilLine",
  <>
    <path
      transform="translate(.3 -.4) scale(.9)"
      d="M2.75 13.25 3.3 10.6l7.4-7.4a1.25 1.25 0 0 1 1.77 0l.33.33a1.25 1.25 0 0 1 0 1.77l-7.4 7.4-2.65.55ZM3.3 10.6l2.1 2.1"
    />
    <path d="M8.5 13.5h5" />
  </>,
);

export const AngleIcon = /*#__PURE__*/ createIcon(
  "Angle",
  <path d="M2.5 13.5h11M2.5 13.5 10 3M7 13.5a4.5 4.5 0 0 0-1.9-3.6" />,
);

export const BezierCurveIcon = /*#__PURE__*/ createIcon(
  "BezierCurve",
  <>
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <path d="M5 12.5C9.5 12.5 6.5 3.5 11 3.5" />
  </>,
);

export const BoundingBoxIcon = /*#__PURE__*/ createIcon(
  "BoundingBox",
  <>
    <path d="M6.5 3.5h3M6.5 12.5h3M3.5 6.5v3M12.5 6.5v3" />
    <circle cx="3.5" cy="3.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="3.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
  </>,
);

export const CropIcon = /*#__PURE__*/ createIcon("Crop", <path d="M5 2.75V11h8.25M2.75 5H11v8.25" />);

export const CrosshairIcon = /*#__PURE__*/ createIcon(
  "Crosshair",
  <>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 2v3.5M8 10.5V14M2 8h3.5M10.5 8H14" />
  </>,
);

export const CursorClickIcon = /*#__PURE__*/ createIcon(
  "CursorClick",
  <>
    <path d="M6.5 6.5 13.5 9.25 10.6 10.6 9.25 13.5Z" />
    <path d="M6 2.25v1.75M2.25 6H4M3.5 3.5l1.2 1.2M8.5 3.5 7.3 4.7" />
  </>,
);

export const EraserIcon = /*#__PURE__*/ createIcon(
  "Eraser",
  <>
    <path d="M3.38 8.62 8.12 3.88a1.25 1.25 0 0 1 1.76 0l2.24 2.24a1.25 1.25 0 0 1 0 1.76l-4.74 4.74a1.25 1.25 0 0 1-1.76 0L3.38 10.38a1.25 1.25 0 0 1 0-1.76ZM5.1 6.9l4 4" />
    <path d="M10.5 13.5h3" />
  </>,
);

export const EyedropperIcon = /*#__PURE__*/ createIcon(
  "Eyedropper",
  <g transform="rotate(45 8 8)">
    <path d="M6.25 6.5V4a1.75 1.75 0 0 1 3.5 0v2.5M4.75 6.5h6.5M6.25 6.5v4.5L8 14l1.75-3V6.5" />
  </g>,
);

export const FlipHorizontalIcon = /*#__PURE__*/ createIcon(
  "FlipHorizontal",
  <>
    <path d="M8 2v2M8 7v2M8 12v2" />
    <path d="M5.5 4.5 2.5 12h3ZM10.5 4.5 13.5 12h-3Z" />
  </>,
);

export const FlipVerticalIcon = /*#__PURE__*/ createIcon(
  "FlipVertical",
  <>
    <path d="M2 8h2M7 8h2M12 8h2" />
    <path d="M4.5 5.5 12 2.5v3ZM4.5 10.5 12 13.5v-3Z" />
  </>,
);

export const LineSegmentIcon = /*#__PURE__*/ createIcon(
  "LineSegment",
  <>
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <path d="M4.56 11.44 11.44 4.56" />
  </>,
);

export const MagicWandIcon = /*#__PURE__*/ createIcon(
  "MagicWand",
  <>
    <path d="M2.5 11.75 8.75 5.5 10.5 7.25 4.25 13.5Z" />
    <path d="M12 2v3M10.5 3.5h3M4 2.5v2.5M2.75 3.75h2.5" />
  </>,
);

export const PaintBrushIcon = /*#__PURE__*/ createIcon(
  "PaintBrush",
  <>
    <path d="M6.4 6.4l3.2 3.2c0 2.3-1.8 4-6.85 3.65C2.5 8.2 4.1 6.4 6.4 6.4Z" />
    <path d="M8 8l5.25-5.25" />
  </>,
);

export const PaintBucketIcon = /*#__PURE__*/ createIcon(
  "PaintBucket",
  <>
    <path d="M6.5 3 11.5 8 6.5 13 1.5 8ZM1.5 8h10" />
    <path d="M13 10.5s-1.2 1.3-1.2 2.2a1.2 1.2 0 0 0 2.4 0c0-.9-1.2-2.2-1.2-2.2Z" />
  </>,
);

export const PaletteIcon = /*#__PURE__*/ createIcon(
  "Palette",
  <>
    <path d={PALETTE_BODY} />
    <circle cx="5" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="10" cy="5" r="1" fill="currentColor" stroke="none" />
  </>,
  <path
    transform="translate(8 8) scale(1.1) translate(-8 -8)"
    fillRule="evenodd"
    d={`${PALETTE_BODY}${hole(5, 8, 1.1)}${hole(6.5, 5, 1.1)}${hole(10, 5, 1.1)}`}
  />,
);

export const PenNibIcon = /*#__PURE__*/ createIcon(
  "PenNib",
  <g transform="rotate(45 8 8)">
    <path d="M8 14 3.75 8 5.25 2.5h5.5L12.25 8Z" />
    <circle cx="8" cy="6.75" r="1" />
    <path d="M8 7.75V14" />
  </g>,
);

export const PerspectiveIcon = /*#__PURE__*/ createIcon(
  "Perspective",
  <>
    <path d="M5.25 3.5h5.5l2.75 9h-11Z" />
    <path d="M3.9 8h8.2M8 3.5v9" />
  </>,
);

export const RulerIcon = /*#__PURE__*/ createIcon(
  "Ruler",
  <g transform="rotate(-45 8 8)">
    <rect x="1.75" y="5.5" width="12.5" height="5" rx="1.25" />
    <path d="M5 5.5v2M8 5.5v2.75M11 5.5v2" />
  </g>,
);

export const ScissorsIcon = /*#__PURE__*/ createIcon(
  "Scissors",
  <>
    <circle cx="4" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M5.3 10.5 12.5 2.5M10.7 10.5 3.5 2.5" />
  </>,
);

const SELECTION =
  "M2.5 4.75V4A1.5 1.5 0 0 1 4 2.5h.75M11.25 2.5H12A1.5 1.5 0 0 1 13.5 4v.75M13.5 11.25V12a1.5 1.5 0 0 1-1.5 1.5h-.75M4.75 13.5H4A1.5 1.5 0 0 1 2.5 12v-.75M7.5 2.5h1M7.5 13.5h1M2.5 7.5v1M13.5 7.5v1";

export const SelectionIcon = /*#__PURE__*/ createIcon(
  "Selection",
  <path d={SELECTION} />,
  <>
    <path d={SELECTION} fill="none" stroke="currentColor" strokeWidth={1.25} />
    <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" />
  </>,
);

export const SwatchesIcon = /*#__PURE__*/ createIcon(
  "Swatches",
  <>
    <rect x="2.5" y="2.5" width="5" height="11" rx="1.5" />
    <circle cx="5" cy="10.75" r="1" fill="currentColor" stroke="none" />
    <path d="M7.5 4.4 7.9 3.7A1.3 1.3 0 0 1 9.7 3.4l2.4 1.7a1.3 1.3 0 0 1 .3 1.8L7.5 12.9" />
  </>,
);

export const VectorThreeIcon = /*#__PURE__*/ createIcon(
  "VectorThree",
  <>
    <rect x="2" y="11" width="3" height="3" rx=".75" />
    <rect x="11" y="11" width="3" height="3" rx=".75" />
    <rect x="6.5" y="2" width="3" height="3" rx=".75" />
    <path d="M5 12.5h6M4 11l3-6M12 11l-3-6" />
  </>,
);

export const DropHalfIcon = /*#__PURE__*/ createIcon(
  "DropHalf",
  <>
    <path d="M8 2.25C5.5 4.5 3.5 7 3.5 9.5a4.5 4.5 0 0 0 9 0C12.5 7 10.5 4.5 8 2.25Z" />
    <path d="M8 2.25C5.5 4.5 3.5 7 3.5 9.5A4.5 4.5 0 0 0 8 14Z" fill="currentColor" />
  </>,
);

export const CircleHalfIcon = /*#__PURE__*/ createIcon(
  "CircleHalf",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 2a6 6 0 0 0 0 12Z" fill="currentColor" />
  </>,
);

export const ExcludeSquareIcon = /*#__PURE__*/ createIcon(
  "ExcludeSquare",
  <>
    <path d={`${SQ_A}${SQ_B}`} fill="currentColor" fillOpacity={0.35} fillRule="evenodd" stroke="none" />
    <path d={SQ_A} />
    <path d={SQ_B} />
  </>,
);

export const UniteSquareIcon = /*#__PURE__*/ createIcon(
  "UniteSquare",
  <>
    <path d={`${SQ_A}${SQ_B}`} fill="currentColor" fillOpacity={0.35} stroke="none" />
    <path d={SQ_A} />
    <path d={SQ_B} />
  </>,
);

export const IntersectSquareIcon = /*#__PURE__*/ createIcon(
  "IntersectSquare",
  <>
    <path
      d="M5.5 7A1.5 1.5 0 0 1 7 5.5h3.5V9a1.5 1.5 0 0 1-1.5 1.5H5.5Z"
      fill="currentColor"
      fillOpacity={0.35}
      stroke="none"
    />
    <path d={SQ_A} />
    <path d={SQ_B} />
  </>,
);

export const SubtractSquareIcon = /*#__PURE__*/ createIcon(
  "SubtractSquare",
  <>
    <path
      d="M4 2.5H9A1.5 1.5 0 0 1 10.5 4V5.5H7A1.5 1.5 0 0 0 5.5 7V10.5H4A1.5 1.5 0 0 1 2.5 9V4A1.5 1.5 0 0 1 4 2.5Z"
      fill="currentColor"
      fillOpacity={0.35}
      stroke="none"
    />
    <path d={SQ_A} />
    <path d={SQ_B} />
  </>,
);

export const IntersectIcon = /*#__PURE__*/ createIcon(
  "Intersect",
  <>
    <path
      d="M8 4.133A4.4 4.4 0 0 1 8 11.867 4.4 4.4 0 0 1 8 4.133Z"
      fill="currentColor"
      fillOpacity={0.35}
      stroke="none"
    />
    <circle cx="5.9" cy="8" r="4.4" />
    <circle cx="10.1" cy="8" r="4.4" />
  </>,
);

export const SquareHalfBottomIcon = /*#__PURE__*/ createIcon(
  "SquareHalfBottom",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <path d="M2.5 8h11v3.75a1.75 1.75 0 0 1-1.75 1.75h-7.5A1.75 1.75 0 0 1 2.5 11.75Z" fill="currentColor" />
  </>,
);

export const GridNineIcon = /*#__PURE__*/ createIcon(
  "GridNine",
  <>
    {[3.5, 8, 12.5].flatMap((y) =>
      [3.5, 8, 12.5].map((x) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="currentColor" stroke="none" />
      )),
    )}
  </>,
);
