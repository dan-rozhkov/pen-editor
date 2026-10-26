import { createIcon } from "../createIcon";
import { slashed } from "./slash";

// Shapes, devices, containers and data objects.

export const TableIcon = /*#__PURE__*/ createIcon(
  "Table",
  // Header row and one column: a second row line sat 3.25 under the header
  // and closed up at small sizes (STYLE.md, "Gaps").
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.75" />
    <path d="M2.5 6.75h11M6.5 6.75V13" />
  </>,
);

export const DatabaseIcon = /*#__PURE__*/ createIcon(
  "Database",
  <>
    <ellipse cx="8" cy="4.5" rx="5.25" ry="2" />
    <path d="M2.75 4.5v7c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-7M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2" />
  </>,
);

export const CircleIcon = /*#__PURE__*/ createIcon(
  "Circle",
  <circle cx="8" cy="8" r="6" />,
  <circle cx="8" cy="8" r="6.6" />,
);

export const CircleNotchIcon = /*#__PURE__*/ createIcon("CircleNotch", <path d="M8 2A6 6 0 1 0 14 8" />);

export const SquareIcon = /*#__PURE__*/ createIcon("Square", <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />);

export const RectangleIcon = /*#__PURE__*/ createIcon("Rectangle", <rect x="2" y="4" width="12" height="8" rx="1.75" />);

export const HexagonIcon = /*#__PURE__*/ createIcon("Hexagon", <path d="M8 2l5.2 3v6L8 14l-5.2-3V5z" />);

export const StarIcon = /*#__PURE__*/ createIcon(
  "Star",
  <path d="M8 2L9.76 6.07L14.18 6.49L10.85 9.43L11.82 13.76L8 11.5L4.18 13.76L5.15 9.43L1.82 6.49L6.24 6.07z" />,
);

export const SphereIcon = /*#__PURE__*/ createIcon(
  "Sphere",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8a6 2.5 0 0 0 12 0" />
  </>,
);

export const CubeIcon = /*#__PURE__*/ createIcon(
  "Cube",
  <>
    <path d="M8 2l5.5 3v6L8 14l-5.5-3V5z" />
    <path d="M2.5 5L8 8l5.5-3M8 8v6" />
  </>,
);

export const CubeFocusIcon = /*#__PURE__*/ createIcon(
  "CubeFocus",
  <>
    <path d="M2.5 5.25v-.75a2 2 0 0 1 2-2h.75M10.75 2.5h.75a2 2 0 0 1 2 2v.75M13.5 10.75v.75a2 2 0 0 1-2 2h-.75M5.25 13.5H4.5a2 2 0 0 1-2-2v-.75" />
    <path d="M8 4.5l2.9 1.65v3.7L8 11.5 5.1 9.85v-3.7zM5.1 6.15L8 7.85l2.9-1.7M8 7.85v3.65" />
  </>,
);

export const StackIcon = /*#__PURE__*/ createIcon(
  "Stack",
  <>
    <path d="M8 2.5l6 3-6 3-6-3z" />
    <path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3" />
  </>,
);

export const CardsIcon = /*#__PURE__*/ createIcon(
  "Cards",
  <>
    <rect x="2.5" y="5.5" width="8" height="8" rx="1.75" />
    <path d="M5.5 2.5h6.25a1.75 1.75 0 0 1 1.75 1.75V10" />
  </>,
);

export const SquaresFourIcon = /*#__PURE__*/ createIcon(
  "SquaresFour",
  <>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.25" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.25" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.25" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1.25" />
  </>,
);

export const ImageIcon = /*#__PURE__*/ createIcon(
  "Image",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <circle cx="10.5" cy="5.75" r="1" fill="currentColor" stroke="none" />
    <path d="M2.5 10.75L6.25 7l4 4 1.5-1.5 1.75 1.75" />
  </>,
);

export const ImageBrokenIcon = /*#__PURE__*/ createIcon("ImageBroken", (uid) =>
  slashed(uid, "ImageBroken",
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
      <circle cx="10.5" cy="5.75" r="1" fill="currentColor" stroke="none" />
      <path d="M2.5 10.75L6.25 7l4 4 1.5-1.5 1.75 1.75" />
    </>,
  ),
);

export const ImageSquareIcon = /*#__PURE__*/ createIcon(
  "ImageSquare",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
    <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
    <path d="M4.5 13.5l4-4.5 5 4" />
  </>,
);

export const ImagesSquareIcon = /*#__PURE__*/ createIcon(
  "ImagesSquare",
  // The back image is only its top and right edges, 3.5 units off the
  // front one; its left stub used to stop 1.75 above it (STYLE.md, "Gaps").
  <>
    <rect x="2.25" y="5.75" width="8" height="8" rx="1.5" />
    <path d="M2.25 11.25 5.5 9l4.75 3.25" />
    <path d="M7.25 2.25H12A1.75 1.75 0 0 1 13.75 4v4.75" />
  </>,
);

export const FilmStripIcon = /*#__PURE__*/ createIcon(
  "FilmStrip",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <path d="M5.5 2.5v11M10.5 2.5v11M2.5 8h3M10.5 8h3" />
  </>,
);

/** Body and viewfinder hump as one closed outline (no separate hump line). */
const CAMERA_BODY =
  "M2 6a1.75 1.75 0 0 1 1.75-1.75h1.5l1-1.5h3.5l1 1.5h1.5A1.75 1.75 0 0 1 14 6v5.5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 11.5Z";

export const CameraIcon = /*#__PURE__*/ createIcon(
  "Camera",
  <>
    <path d={CAMERA_BODY} />
    <circle cx="8" cy="8.5" r="2.25" />
  </>,
  (uid) => (
    <>
      <mask id={`mCamera${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <path d={CAMERA_BODY} fill="white" stroke="white" />
        <circle cx="8" cy="8.5" r="2.25" fill="black" stroke="none" />
      </mask>
      <rect x="0" y="0" width="16" height="16" mask={`url(#mCamera${uid})`} stroke="none" />
    </>
  ),
);

export const BrowserIcon = /*#__PURE__*/ createIcon(
  "Browser",
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.75" />
    <path d="M2 6.5h12" />
  </>,
);

export const BrowsersIcon = /*#__PURE__*/ createIcon(
  "Browsers",
  <>
    <rect x="2" y="6" width="9" height="7.5" rx="1.5" />
    <path d="M2 8.75h9" />
    <path d="M5 4.25A1.75 1.75 0 0 1 6.75 2.5h5.5A1.75 1.75 0 0 1 14 4.25v4.5a1.75 1.75 0 0 1-1.75 1.75" />
  </>,
);

export const DeviceMobileIcon = /*#__PURE__*/ createIcon(
  "DeviceMobile",
  <>
    <rect x="4.5" y="2" width="7" height="12" rx="1.75" />
    <path d="M6.75 11.75h2.5" />
  </>,
);

export const LaptopIcon = /*#__PURE__*/ createIcon(
  "Laptop",
  <>
    <rect x="3.5" y="3.5" width="9" height="7" rx="1.25" />
    <path d="M2 12.5h12" />
  </>,
);

export const KeyboardIcon = /*#__PURE__*/ createIcon(
  "Keyboard",
  <>
    <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.75" />
    <path d="M5 6.5h.01M8 6.5h.01M11 6.5h.01" />
    <path d="M5 9.5h6" />
  </>,
  <path
    fillRule="evenodd"
    d="M3.5 2.9h9a2.35 2.35 0 0 1 2.35 2.35v5.5a2.35 2.35 0 0 1-2.35 2.35h-9A2.35 2.35 0 0 1 1.15 10.75v-5.5A2.35 2.35 0 0 1 3.5 2.9zM5 5.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM8 5.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM11 5.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM5 8.85h6a.65.65 0 0 1 0 1.3H5a.65.65 0 0 1 0-1.3z"
  />,
);

export const SidebarIcon = /*#__PURE__*/ createIcon(
  "Sidebar",
  // A panel half the window wide (SidebarSimple's is a third). The row
  // dashes inside it sat < 2 units from the edges (STYLE.md, "Gaps").
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.75" />
    <path d="M8 3v10" />
  </>,
);

export const SidebarSimpleIcon = /*#__PURE__*/ createIcon(
  "SidebarSimple",
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.75" />
    <path d="M6.5 3v10" />
  </>,
);

export const PlugsIcon = /*#__PURE__*/ createIcon(
  "Plugs",
  <>
    <path d="M5.75 2v3M10.25 2v3M4.25 5h7.5v2.5a3.75 3.75 0 0 1-7.5 0zM8 11.25V14" />
  </>,
);

export const PuzzlePieceIcon = /*#__PURE__*/ createIcon(
  "PuzzlePiece",
  <path d="M3.5 5.5H5.55A1.8 1.8 0 1 1 7.95 5.5H10a1 1 0 0 1 1 1V7.8A1.8 1.8 0 1 1 11 10.2V12.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V11.4A1.8 1.8 0 1 0 2.5 9V6.5a1 1 0 0 1 1-1z" />,
  <path d="M3.5 4.9H4.47A2.4 2.4 0 1 1 9.03 4.9H10a1.6 1.6 0 0 1 1.6 1.6V6.72A2.4 2.4 0 1 1 11.6 11.28V12.5a1.6 1.6 0 0 1-1.6 1.6H3.5a1.6 1.6 0 0 1-1.6-1.6V10.775H2.79A1.2 1.2 0 1 0 2.79 9.625H1.9V6.5a1.6 1.6 0 0 1 1.6-1.6z" />,
);

export const KeyIcon = /*#__PURE__*/ createIcon(
  "Key",
  <>
    <circle cx="5.25" cy="8" r="3.25" />
    <path d="M8.5 8H14M11.25 8v2.75M14 8v2.5" />
  </>,
);

export const LockIcon = /*#__PURE__*/ createIcon(
  "Lock",
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.75" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    <circle cx="8" cy="10.25" r="1" fill="currentColor" stroke="none" />
  </>,
  undefined,
  { scale: 1.06 },
);

export const WrenchIcon = /*#__PURE__*/ createIcon(
  "Wrench",
  <g transform="translate(0 .6) rotate(45 8 7.55)">
    <path d="M6.75 1.98V4.5h2.5V1.98A3.5 3.5 0 0 1 9.3 8.5V13a1.3 1.3 0 0 1-2.6 0V8.5A3.5 3.5 0 0 1 6.75 1.98z" />
  </g>,
  undefined,
  // Optics: grown to the 13 × 13 diagonal box (STYLE.md, "Optical balance").
  { scale: 1.15 },
);

export const GearIcon = /*#__PURE__*/ createIcon(
  "Gear",
  <>
    <path d="M6.55 3.53L6.67 1.74L9.33 1.74L9.45 3.53A4.7 4.7 0 0 1 11.14 4.51L12.76 3.72L14.09 6.02L12.6 7.02A4.7 4.7 0 0 1 12.6 8.98L14.09 9.98L12.76 12.28L11.14 11.49A4.7 4.7 0 0 1 9.45 12.47L9.33 14.26L6.67 14.26L6.55 12.47A4.7 4.7 0 0 1 4.86 11.49L3.24 12.28L1.91 9.98L3.4 8.98A4.7 4.7 0 0 1 3.4 7.02L1.91 6.02L3.24 3.72L4.86 4.51A4.7 4.7 0 0 1 6.55 3.53z" />
    <circle cx="8" cy="8" r="2" />
  </>,
);

export const SlidersHorizontalIcon = /*#__PURE__*/ createIcon(
  "SlidersHorizontal",
  <>
    <circle cx="10" cy="5" r="1.75" />
    <path d="M2.5 5h5.75M11.75 5h1.75" />
    <circle cx="6" cy="11" r="1.75" />
    <path d="M2.5 11h1.75M7.75 11h5.75" />
  </>,
);
