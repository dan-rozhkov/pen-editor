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
const UNION =
  "M4 2.5H9A1.5 1.5 0 0 1 10.5 4V5.5H12A1.5 1.5 0 0 1 13.5 7V12A1.5 1.5 0 0 1 12 13.5H7A1.5 1.5 0 0 1 5.5 12V10.5H4A1.5 1.5 0 0 1 2.5 9V4A1.5 1.5 0 0 1 4 2.5Z";
const SQ_B = rr(5.5, 5.5, 8, 8, 1.5);

const PALETTE_BODY =
  "M8 2a6 6 0 1 0 0 12c1.1 0 1.6-.7 1.6-1.4 0-.9-.6-1.1-.6-1.9 0-.8.6-1.1 1.4-1.1H12a2 2 0 0 0 2-2C14 4.2 11.3 2 8 2Z";

export const PencilSimpleIcon = /*#__PURE__*/ createIcon(
  "PencilSimple",
  <path d="M2.75 13.25 3.3 10.6l7.4-7.4a1.25 1.25 0 0 1 1.77 0l.33.33a1.25 1.25 0 0 1 0 1.77l-7.4 7.4-2.65.55ZM9.5 4.5l2 2" />,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.14 },
);

export const PencilSimpleLineIcon = /*#__PURE__*/ createIcon(
  "PencilSimpleLine",
  <>
    <path
      transform="translate(-.25 -.75)"
      d="M2.75 13.25 3.3 10.6l7.4-7.4a1.25 1.25 0 0 1 1.77 0l.33.33a1.25 1.25 0 0 1 0 1.77l-7.4 7.4-2.65.55ZM9.5 4.5l2 2"
    />
    <path d="M8.5 13.5h5" />
  </>,
);

export const PencilLineIcon = /*#__PURE__*/ createIcon(
  "PencilLine",
  <>
    <path
      transform="translate(-.25 -.75)"
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
    <rect x="2" y="10.5" width="3.5" height="3.5" rx=".75" />
    <rect x="10.5" y="2" width="3.5" height="3.5" rx=".75" />
    <path d="M3.75 10.5C3.75 5.5 12.25 10.5 12.25 5.5" />
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
    <path d="M6.25 6.25 13.5 9 10.5 10.5 9 13.5Z" />
    <path d="M6.25 2v2M2 6.25h2M3.4 3.4l1.4 1.4M9.1 3.4 7.7 4.8" />
  </>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.04 },
);

export const EraserIcon = /*#__PURE__*/ createIcon(
  "Eraser",
  <>
    <path d="M3.38 8.62 8.12 3.88a1.25 1.25 0 0 1 1.76 0l2.24 2.24a1.25 1.25 0 0 1 0 1.76l-4.74 4.74a1.25 1.25 0 0 1-1.76 0L3.38 10.38a1.25 1.25 0 0 1 0-1.76ZM5.1 6.9l4 4" />
    <path d="M10.5 13.5h3" />
  </>,
  undefined,
  // Optics: grown and re-centred; it read small next to the pencils (STYLE.md).
  { scale: 1.1, dx: -0.3, dy: -0.55 },
);

export const EyedropperIcon = /*#__PURE__*/ createIcon(
  "Eyedropper",
  <g transform="rotate(45 8 8)">
    <rect x="6" y="0.75" width="4" height="3.75" rx="1.75" />
    <path d="M4.75 7.5h6.5M6 7.5V12L8 15l2-3V7.5" />
  </g>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.1, dx: -0.45, dy: 0.45 },
);

export const FlipHorizontalIcon = /*#__PURE__*/ createIcon(
  "FlipHorizontal",
  // Isosceles halves, bases 3.25 apart (see FlipVertical).
  <path d="M6.375 3v10L2.375 8ZM9.625 3v10l4-5Z" />,
);

export const FlipVerticalIcon = /*#__PURE__*/ createIcon(
  "FlipVertical",
  // Isosceles halves, bases 3.25 apart: the right-angled ones ended in a
  // sliver that closed up at 14px (STYLE.md, "Gaps").
  <path d="M3 6.375h10L8 2.375ZM3 9.625h10L8 13.625Z" />,
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
    <rect x="6.75" y="7.5" width="2.5" height="7" rx="1.25" transform="rotate(45 8 8)" />
    <path d="M11.5 1.75c.3 1.9.8 2.4 2.75 2.75-1.95.35-2.45.85-2.75 2.75-.3-1.9-.8-2.4-2.75-2.75 1.95-.35 2.45-.85 2.75-2.75Z" />
  </>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.06, dx: -0.7, dy: 0.7 },
);

export const PaintBrushIcon = /*#__PURE__*/ createIcon(
  "PaintBrush",
  // Symmetric about the x + y = 16 diagonal: handle top-right, ferrule,
  // then a teardrop of bristles ending in a tip bottom-left.
  <>
    <rect x="10.68" y="1.61" width="2" height="5.44" rx="1" transform="rotate(45 11.68 4.33)" />
    <path d="M10.81 7.31 8.69 5.19 7.28 6.6 9.4 8.72Z" />
    <path d="M7.28 6.6C4 6.6 2.3 9.2 2.5 13.5c4.3.2 6.9-1.5 6.9-4.78" />
  </>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.06 },
);

export const PaintBucketIcon = /*#__PURE__*/ createIcon(
  "PaintBucket",
  <>
    <path d="M7 3 2.5 7.5l3.6 3.6a1.27 1.27 0 0 0 1.8 0L11.5 7.5ZM2.5 7.5h9" />
    <path d="M12.5 9.75s-1.5 1.5-1.5 2.5a1.5 1.5 0 0 0 3 0c0-1-1.5-2.5-1.5-2.5Z" />
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
    <path d="M8 14.25 3.75 8l1.5-5.5h5.5l1.5 5.5Z" />
    <path d="M8 14.25V8.9" />
    <circle cx="8" cy="7.5" r="1.4" />
  </g>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.15, dx: -0.8, dy: 0.8 },
);

export const PerspectiveIcon = /*#__PURE__*/ createIcon(
  "Perspective",
  <>
    <path d="M5.5 3.5h5l3 9h-11Z" />
    <path d="M4 8.5h8" />
  </>,
);

export const RulerIcon = /*#__PURE__*/ createIcon(
  "Ruler",
  <g transform="rotate(-45 8 8)">
    <rect x="1.25" y="5.25" width="13.5" height="5.5" rx="1.5" />
    <path d="M5.5 5.25v2.5M10.5 5.25v2.5" />
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
    <path d={SELECTION} fill="none" stroke="currentColor" />
    <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" />
  </>,
);

export const SwatchesIcon = /*#__PURE__*/ createIcon(
  "Swatches",
  <>
    <rect x="2.5" y="2.5" width="5" height="11" rx="1.5" />
    <circle cx="5" cy="11" r="1" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5l3.6-1.6a1.5 1.5 0 0 1 2 .8l.4 1V12a1.5 1.5 0 0 1-1.5 1.5H7.5" />
  </>,
);

export const VectorThreeIcon = /*#__PURE__*/ createIcon(
  "VectorThree",
  <>
    <rect x="6.25" y="1.75" width="3.5" height="3.5" rx=".75" />
    <rect x="1.75" y="10.75" width="3.5" height="3.5" rx=".75" />
    <rect x="10.75" y="10.75" width="3.5" height="3.5" rx=".75" />
    <path d="M7.1 5.75 4.4 10.25M8.9 5.75l2.7 4.5M5.25 12.5h5.5" />
  </>,
);

export const DropHalfIcon = /*#__PURE__*/ createIcon(
  "DropHalf",
  <>
    <path d="M8 2.25C5.5 4.5 3.5 7 3.5 9.5a4.5 4.5 0 0 0 9 0C12.5 7 10.5 4.5 8 2.25Z" />
    <path d="M8 7.25a2.25 2.25 0 0 0 0 4.5Z" fill="currentColor" stroke="none" />
  </>,
);

export const CircleHalfIcon = /*#__PURE__*/ createIcon(
  "CircleHalf",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5a3.5 3.5 0 0 0 0 7Z" fill="currentColor" stroke="none" />
  </>,
);

export const ExcludeSquareIcon = /*#__PURE__*/ createIcon(
  "ExcludeSquare",
  <>
    <path
      d={`${UNION}M5.5 7A1.5 1.5 0 0 1 7 5.5h3.5V9a1.5 1.5 0 0 1-1.5 1.5H5.5Z`}
      fill="currentColor"
      fillRule="evenodd"
      stroke="none"
    />
    <path d={UNION} />
  </>,
);

export const UniteSquareIcon = /*#__PURE__*/ createIcon(
  "UniteSquare",
  <path d={UNION} />,
);

export const IntersectSquareIcon = /*#__PURE__*/ createIcon(
  "IntersectSquare",
  <>
    <path d={SQ_A} />
    <path d={SQ_B} />
    <path d="M5.5 7A1.5 1.5 0 0 1 7 5.5h3.5V9a1.5 1.5 0 0 1-1.5 1.5H5.5Z" fill="currentColor" stroke="none" />
  </>,
);

export const SubtractSquareIcon = /*#__PURE__*/ createIcon(
  "SubtractSquare",
  <>
    <path
      d="M4 2.5H9A1.5 1.5 0 0 1 10.5 4V5.5H7A1.5 1.5 0 0 0 5.5 7V10.5H4A1.5 1.5 0 0 1 2.5 9V4A1.5 1.5 0 0 1 4 2.5Z"
      fill="currentColor"
    />
    <path d={SQ_B} />
  </>,
);

export const IntersectIcon = /*#__PURE__*/ createIcon(
  "Intersect",
  <>
    <circle cx="5.9" cy="8" r="4.4" />
    <circle cx="10.1" cy="8" r="4.4" />
    <path d="M8 4.133A4.4 4.4 0 0 1 8 11.867 4.4 4.4 0 0 1 8 4.133Z" fill="currentColor" stroke="none" />
  </>,
);

export const SquareHalfBottomIcon = /*#__PURE__*/ createIcon(
  "SquareHalfBottom",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <path d="M5 8h6v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" fill="currentColor" stroke="none" />
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
