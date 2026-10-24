import { createIcon } from "../createIcon";

// Shapes, devices, containers and data objects.

export const TableIcon = /*#__PURE__*/ createIcon(
  "Table",
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.75" />
    <path d="M2.5 6.5h11M6.5 6.5V13M2.5 9.75h11" />
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
    <ellipse cx="8" cy="8" rx="6" ry="2.5" />
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
    <path d="M2.5 5.5v-1a2 2 0 0 1 2-2h1M10.5 2.5h1a2 2 0 0 1 2 2v1M13.5 10.5v1a2 2 0 0 1-2 2h-1M5.5 13.5h-1a2 2 0 0 1-2-2v-1" />
    <path d="M8 5l2.6 1.5v3L8 11 5.4 9.5v-3zM5.4 6.5L8 8l2.6-1.5M8 8v3" />
  </>,
);

export const StackIcon = /*#__PURE__*/ createIcon(
  "Stack",
  <>
    <path d="M8 2.5l6 3-6 3-6-3z" />
    <path d="M2 8.25l6 3 6-3M2 11l6 3 6-3" />
  </>,
);

export const CardsIcon = /*#__PURE__*/ createIcon(
  "Cards",
  <>
    <rect x="2.5" y="5.5" width="11" height="8" rx="1.75" />
    <path d="M4.5 2.75h7" />
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

export const ImageBrokenIcon = /*#__PURE__*/ createIcon(
  "ImageBroken",
  <>
    <path d="M9 2.5H4.25A1.75 1.75 0 0 0 2.5 4.25v7.5a1.75 1.75 0 0 0 1.75 1.75H5.5L8.75 8 7.25 6.5z" />
    <circle cx="4.9" cy="5.25" r="1" fill="currentColor" stroke="none" />
    <path d="M11.25 2.5h.5a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75H7.75L11 8 9.5 6.5z" />
  </>,
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
  <>
    <rect x="2.5" y="6" width="7.5" height="7.5" rx="1.5" />
    <path d="M2.5 11.5L5 9l3 3 1-1" />
    <path d="M5.5 4V4.25A1.75 1.75 0 0 1 7.25 2.5h4.5a1.75 1.75 0 0 1 1.75 1.75v4.5a1.75 1.75 0 0 1-1.75 1.75" />
  </>,
);

export const FilmStripIcon = /*#__PURE__*/ createIcon(
  "FilmStrip",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <path d="M5.5 2.5v11M10.5 2.5v11M2.5 6h3M2.5 10h3M10.5 6h3M10.5 10h3" />
  </>,
);

export const CameraIcon = /*#__PURE__*/ createIcon(
  "Camera",
  <>
    <rect x="2" y="4.5" width="12" height="8.5" rx="1.75" />
    <path d="M5.5 4.5l.9-1.75h3.2l.9 1.75" />
    <circle cx="8" cy="8.75" r="2.5" />
  </>,
  <path
    fillRule="evenodd"
    d="M1.4 5.9a2 2 0 0 1 2-2h2.1l.9-1.75h3.2l.9 1.75h2.1a2 2 0 0 1 2 2v5.7a2 2 0 0 1-2 2H3.4a2 2 0 0 1-2-2zM8 6.55a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"
  />,
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
    <rect x="2" y="4" width="12" height="8" rx="1.75" />
    <circle cx="5" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="11" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
    <path d="M5.5 9.5h5" />
  </>,
  <path
    fillRule="evenodd"
    d="M3.4 3.4h9.2a2 2 0 0 1 2 2v5.2a2 2 0 0 1-2 2H3.4a2 2 0 0 1-2-2V5.4a2 2 0 0 1 2-2zM5 5.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM8 5.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM11 5.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM5.65 8.85h4.7a.65.65 0 0 1 0 1.3h-4.7a.65.65 0 0 1 0-1.3z"
  />,
);

export const SidebarIcon = /*#__PURE__*/ createIcon(
  "Sidebar",
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.75" />
    <path d="M6.5 3v10M4 6h.01M4 8.5h.01" />
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
  <g transform="rotate(-45 8 8)">
    <path d="M1.5 8h2M3.5 5.5h3.5v5H3.5zM7 6.5h3.5M7 9.5h3.5M10.5 5.5h3.5v5h-3.5zM14 8h.5" />
  </g>,
);

export const PuzzlePieceIcon = /*#__PURE__*/ createIcon(
  "PuzzlePiece",
  <path d="M3.5 5.5H5a1.75 1.75 0 1 1 3 0H9.5a1 1 0 0 1 1 1V8a1.75 1.75 0 1 1 0 3v1.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />,
  <path d="M3.5 4.9H4.17A2.35 2.35 0 1 1 8.83 4.9H9.5A1.6 1.6 0 0 1 11.1 6.5V7.17A2.35 2.35 0 1 1 11.1 11.83V12.5A1.6 1.6 0 0 1 9.5 14.1H3.5A1.6 1.6 0 0 1 1.9 12.5V6.5A1.6 1.6 0 0 1 3.5 4.9z" />,
);

export const KeyIcon = /*#__PURE__*/ createIcon(
  "Key",
  <>
    <circle cx="10.5" cy="5.5" r="3.25" />
    <path d="M8.2 7.8L2.5 13.5M6.5 9.5L8 11M4.5 11.5L6 13" />
  </>,
);

export const LockIcon = /*#__PURE__*/ createIcon(
  "Lock",
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.75" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    <circle cx="8" cy="10.25" r="1" fill="currentColor" stroke="none" />
  </>,
);

export const WrenchIcon = /*#__PURE__*/ createIcon(
  "Wrench",
  <g transform="translate(0 .6) rotate(45 8 7.55)">
    <path d="M6.75 1.98V4.5h2.5V1.98A3.5 3.5 0 0 1 9.3 8.5V13a1.3 1.3 0 0 1-2.6 0V8.5A3.5 3.5 0 0 1 6.75 1.98z" />
  </g>,
);

export const GearIcon = /*#__PURE__*/ createIcon(
  "Gear",
  <>
    <path d="M6.26 3.64L6.73 1.73L9.27 1.73L9.74 3.64L9.85 3.68L11.54 2.67L13.33 4.46L12.32 6.15L12.36 6.26L14.27 6.73L14.27 9.27L12.36 9.74L12.32 9.85L13.33 11.54L11.54 13.33L9.85 12.32L9.74 12.36L9.27 14.27L6.73 14.27L6.26 12.36L6.15 12.32L4.46 13.33L2.67 11.54L3.68 9.85L3.64 9.74L1.73 9.27L1.73 6.73L3.64 6.26L3.68 6.15L2.67 4.46L4.46 2.67L6.15 3.68z" />
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
