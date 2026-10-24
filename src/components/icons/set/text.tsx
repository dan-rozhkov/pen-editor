import { createIcon } from "../createIcon";

// Typography, text alignment, object alignment and lists.

// Object alignment: a reference line and two bars of different length.
export const AlignTopIcon = /*#__PURE__*/ createIcon(
  "AlignTop",
  <>
    <path d="M2.75 2.75h10.5" />
    <rect x="4" y="5.5" width="3" height="8" rx="0.75" />
    <rect x="9" y="5.5" width="3" height="5" rx="0.75" />
  </>,
);

export const AlignBottomIcon = /*#__PURE__*/ createIcon(
  "AlignBottom",
  <>
    <path d="M2.75 13.25h10.5" />
    <rect x="4" y="2.5" width="3" height="8" rx="0.75" />
    <rect x="9" y="5.5" width="3" height="5" rx="0.75" />
  </>,
);

export const AlignLeftIcon = /*#__PURE__*/ createIcon(
  "AlignLeft",
  <>
    <path d="M2.75 2.75v10.5" />
    <rect x="5.5" y="4" width="8" height="3" rx="0.75" />
    <rect x="5.5" y="9" width="5" height="3" rx="0.75" />
  </>,
);

export const AlignRightIcon = /*#__PURE__*/ createIcon(
  "AlignRight",
  <>
    <path d="M13.25 2.75v10.5" />
    <rect x="2.5" y="4" width="8" height="3" rx="0.75" />
    <rect x="5.5" y="9" width="5" height="3" rx="0.75" />
  </>,
);

export const AlignCenterHorizontalIcon = /*#__PURE__*/ createIcon(
  "AlignCenterHorizontal",
  <>
    <path d="M8 2.75V4M8 7v2M8 12v1.25" />
    <rect x="3" y="4" width="10" height="3" rx="0.75" />
    <rect x="5" y="9" width="6" height="3" rx="0.75" />
  </>,
);

export const AlignCenterVerticalIcon = /*#__PURE__*/ createIcon(
  "AlignCenterVertical",
  <>
    <path d="M2.75 8H4M7 8h2M12 8h1.25" />
    <rect x="4" y="3" width="3" height="10" rx="0.75" />
    <rect x="9" y="5" width="3" height="6" rx="0.75" />
  </>,
);

// Letterforms, monoline.
export const TextTIcon = /*#__PURE__*/ createIcon("TextT", <path d="M3 3.25h10M8 3.25v9.5" />);

export const TextAaIcon = /*#__PURE__*/ createIcon(
  "TextAa",
  <>
    <path d="M2 12.5 4.75 4l2.75 8.5M3 9.5h3.5" />
    <circle cx="11.75" cy="10.5" r="2" />
    <path d="M13.75 8.5v4" />
  </>,
);

export const TextBIcon = /*#__PURE__*/ createIcon(
  "TextB",
  <path d="M4.5 2.75v10.5M4.5 2.75h4a2.25 2.25 0 0 1 0 4.5M4.5 7.25H9a3 3 0 0 1 0 6H4.5" />,
);

export const TextItalicIcon = /*#__PURE__*/ createIcon(
  "TextItalic",
  <path d="M6.5 2.75h5M4.5 13.25h5M9.75 2.75 6.25 13.25" />,
);

export const TextUnderlineIcon = /*#__PURE__*/ createIcon(
  "TextUnderline",
  <path d="M4.5 2.75v5a3.5 3.5 0 0 0 7 0v-5M3 13.25h10" />,
);

export const TextStrikethroughIcon = /*#__PURE__*/ createIcon(
  "TextStrikethrough",
  <>
    <path d="M2.75 8h10.5" />
    <path d="M10.5 4.5C10 3.4 9.2 2.75 8 2.75c-1.5 0-2.75.8-2.75 2.2 0 .9.4 1.4 1.1 1.8" />
    <path d="M9.65 9.25c.7.45 1.1 1 1.1 1.75 0 1.4-1.25 2.25-2.75 2.25-1.2 0-2.2-.6-2.75-1.75" />
  </>,
);

export const TextSuperscriptIcon = /*#__PURE__*/ createIcon(
  "TextSuperscript",
  <>
    <path d="M2 7h7M5.5 7v6.25" />
    <path d="M11 3.75a1.5 1.5 0 0 1 3 0c0 1.1-1.2 1.7-3 3.25h3" />
  </>,
);

export const TextHOneIcon = /*#__PURE__*/ createIcon(
  "TextHOne",
  <>
    <path d="M2.5 3.5v9M8 3.5v9M2.5 8H8" />
    <path d="M10.5 5.75 12.5 4.5v8" />
  </>,
);

export const TextHTwoIcon = /*#__PURE__*/ createIcon(
  "TextHTwo",
  <>
    <path d="M2.5 3.5v9M8 3.5v9M2.5 8H8" />
    <path d="M10.25 7.25a1.75 1.75 0 0 1 3.5 0c0 1.5-1.5 2.5-3.5 5.25h3.5" />
  </>,
);

export const TextHThreeIcon = /*#__PURE__*/ createIcon(
  "TextHThree",
  <>
    <path d="M2.5 3.5v9M8 3.5v9M2.5 8H8" />
    <path d="M10.3 6.9A1.7 1.7 0 1 1 12 8.6M12 8.6A2 2 0 1 1 10.4 12" />
  </>,
);

export const TextAlignLeftIcon = /*#__PURE__*/ createIcon(
  "TextAlignLeft",
  <path d="M2.75 3.5h10.5M2.75 6.5h6.5M2.75 9.5h10.5M2.75 12.5h6.5" />,
);

export const TextAlignCenterIcon = /*#__PURE__*/ createIcon(
  "TextAlignCenter",
  <path d="M2.75 3.5h10.5M4.75 6.5h6.5M2.75 9.5h10.5M4.75 12.5h6.5" />,
);

export const TextAlignRightIcon = /*#__PURE__*/ createIcon(
  "TextAlignRight",
  <path d="M2.75 3.5h10.5M6.75 6.5h6.5M2.75 9.5h10.5M6.75 12.5h6.5" />,
);

export const TextIndentIcon = /*#__PURE__*/ createIcon(
  "TextIndent",
  <path d="M2.75 3h10.5M8 6.5h5.25M8 9.5h5.25M2.75 13h10.5M2.75 5.75 5.25 8l-2.5 2.25" />,
);

export const TextOutdentIcon = /*#__PURE__*/ createIcon(
  "TextOutdent",
  <path d="M2.75 3h10.5M8 6.5h5.25M8 9.5h5.25M2.75 13h10.5M5.25 5.75 2.75 8l2.5 2.25" />,
);

// Lists.
export const ListIcon = /*#__PURE__*/ createIcon("List", <path d="M2.75 3.5h10.5M2.75 8h10.5M2.75 12.5h10.5" />);

export const ListBulletsIcon = /*#__PURE__*/ createIcon(
  "ListBullets",
  <>
    <circle cx="3.5" cy="3.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <path d="M7 3.5h6.25M7 8h6.25M7 12.5h6.25" />
  </>,
);

export const ListDashesIcon = /*#__PURE__*/ createIcon(
  "ListDashes",
  <path d="M2.75 3.5h1.75M2.75 8h1.75M2.75 12.5h1.75M7.5 3.5h5.75M7.5 8h5.75M7.5 12.5h5.75" />,
);

export const ListChecksIcon = /*#__PURE__*/ createIcon(
  "ListChecks",
  <>
    <path d="M2.5 3.25 3.75 4.5 6 2M2.5 7.75 3.75 9 6 6.5M2.5 12.25 3.75 13.5 6 11" />
    <path d="M8.75 3.5h4.5M8.75 8h4.5M8.75 12.5h4.5" />
  </>,
);

export const ListMagnifyingGlassIcon = /*#__PURE__*/ createIcon(
  "ListMagnifyingGlass",
  <>
    <path d="M2.75 3.5h10.5M2.75 8h2.5M2.75 12.5h2.5" />
    <circle cx="10.5" cy="10" r="2.5" />
    <path d="m12.3 11.8 1.45 1.45" />
  </>,
);

export const ListNumbersIcon = /*#__PURE__*/ createIcon(
  "ListNumbers",
  <>
    <path d="M3 4.5 4.5 3.25v3.25" />
    <path d="M3 10.25a1.5 1.5 0 0 1 3 0c0 1-1.5 1.6-3 3h3" />
    <path d="M8.5 4.75h4.75M8.5 11h4.75" />
  </>,
);

export const QuotesIcon = /*#__PURE__*/ createIcon(
  "Quotes",
  <>
    <rect x="2.75" y="3.5" width="4" height="4" rx="1" />
    <path d="M6.75 7c0 3-1.25 4.5-4 5.25" />
    <rect x="9.25" y="3.5" width="4" height="4" rx="1" />
    <path d="M13.25 7c0 3-1.25 4.5-4 5.25" />
  </>,
);

export const HashIcon = /*#__PURE__*/ createIcon(
  "Hash",
  <path d="M6.9 2.75 4.1 13.25M11.9 2.75 9.1 13.25M2.75 6h10.5M2.75 10h10.5" />,
);

export const HashStraightIcon = /*#__PURE__*/ createIcon(
  "HashStraight",
  <path d="M5.5 2.75v10.5M10.5 2.75v10.5M2.75 6h10.5M2.75 10h10.5" />,
);

export const NumberZeroIcon = /*#__PURE__*/ createIcon(
  "NumberZero",
  <ellipse cx="8" cy="8" rx="3.5" ry="5.25" />,
);

export const AsteriskIcon = /*#__PURE__*/ createIcon(
  "Asterisk",
  <path d="M8 2.5v11M3.25 5.25l9.5 5.5M12.75 5.25l-9.5 5.5" />,
);

export const ArticleIcon = /*#__PURE__*/ createIcon(
  "Article",
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.75" />
    <path d="M5.5 5.25h5M5.5 8h5M5.5 10.75h2.75" />
  </>,
);
