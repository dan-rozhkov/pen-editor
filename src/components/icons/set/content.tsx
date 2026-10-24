import { createIcon } from "../createIcon";

// Files, documents, clipboard, links, search, navigation and organising.

/** Shared file body (3.5 → 12.5 × 2.25 → 14) with the folded corner. */
const FILE =
  "M9.25 2.25H5a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V5.5Z M9.25 2.25V5.5h3.25";

export const FileIcon = /*#__PURE__*/ createIcon("File", <path d={FILE} />);

export const FileCodeIcon = /*#__PURE__*/ createIcon(
  "FileCode",
  <>
    <path d={FILE} />
    <path d="M6.75 8.75 5.75 10.25 6.75 11.75M9.25 8.75l1 1.5-1 1.5" />
  </>,
);

export const FilePlusIcon = /*#__PURE__*/ createIcon(
  "FilePlus",
  <>
    <path d={FILE} />
    <path d="M8 8.75v3.5M6.25 10.5h3.5" />
  </>,
);

export const FileXIcon = /*#__PURE__*/ createIcon(
  "FileX",
  <>
    <path d={FILE} />
    <path d="M6.5 8.75l3 3M9.5 8.75l-3 3" />
  </>,
);

export const FileTextIcon = /*#__PURE__*/ createIcon(
  "FileText",
  <>
    <path d={FILE} />
    <path d="M6 8.75h4M6 11.5h4" />
  </>,
);

export const FilesIcon = /*#__PURE__*/ createIcon(
  "Files",
  <>
    <path d="M10.25 2.25H8A1.5 1.5 0 0 0 6.5 3.75v6.5A1.5 1.5 0 0 0 8 11.75h3.5a1.5 1.5 0 0 0 1.5-1.5V5Z M10.25 2.25V5H13" />
    <path d="M3.5 5.5v7A1.5 1.5 0 0 0 5 14h4.5" />
  </>,
);

export const FolderPlusIcon = /*#__PURE__*/ createIcon(
  "FolderPlus",
  <>
    <path d="M2.5 12.5V4a1 1 0 0 1 1-1h2.4l1.6 1.75h5a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" />
    <path d="M8 7.5v3.5M6.25 9.25h3.5" />
  </>,
);

export const ClipboardTextIcon = /*#__PURE__*/ createIcon(
  "ClipboardText",
  <>
    <path d="M6 3H5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 5 14h6a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 11 3h-1" />
    <rect x="6" y="1.75" width="4" height="2.5" rx="1" />
    <path d="M5.75 8.25h4.5M5.75 11h4.5" />
  </>,
);

export const CopyIcon = /*#__PURE__*/ createIcon(
  "Copy",
  <>
    <rect x="6.25" y="2.5" width="7.25" height="7.25" rx="1.5" />
    <path d="M6.25 6.25H4A1.5 1.5 0 0 0 2.5 7.75V12A1.5 1.5 0 0 0 4 13.5h4.25A1.5 1.5 0 0 0 9.75 12V9.75" />
  </>,
);

export const CopySimpleIcon = /*#__PURE__*/ createIcon(
  "CopySimple",
  <>
    <rect x="5.5" y="2.5" width="8" height="8" rx="1.5" />
    <path d="M5.5 5.5v0H4A1.5 1.5 0 0 0 2.5 7v5A1.5 1.5 0 0 0 4 13.5h5A1.5 1.5 0 0 0 10.5 12v-1.5" />
  </>,
);

export const NoteIcon = /*#__PURE__*/ createIcon(
  "Note",
  <>
    <path d="M4.5 2.75h7a1.75 1.75 0 0 1 1.75 1.75v5L9.5 13.25h-5A1.75 1.75 0 0 1 2.75 11.5v-7A1.75 1.75 0 0 1 4.5 2.75Z" />
    <path d="M9.5 13.25V11a1.5 1.5 0 0 1 1.5-1.5h2.25" />
  </>,
);

export const NotePencilIcon = /*#__PURE__*/ createIcon(
  "NotePencil",
  <>
    <path d="M7.5 2.75h-3A1.75 1.75 0 0 0 2.75 4.5v7c0 .97.78 1.75 1.75 1.75h7c.97 0 1.75-.78 1.75-1.75V8.5" />
    <path d="M12.25 2.25l1.5 1.5-5.5 5.5-2 .5.5-2Z" />
  </>,
);

export const BookOpenIcon = /*#__PURE__*/ createIcon(
  "BookOpen",
  <path d="M8 4.5V13.5M8 4.5C6.75 3.25 4.75 2.75 2.5 3.25v8.75c2.25-.5 4.25 0 5.5 1.5M8 4.5c1.25-1.25 3.25-1.75 5.5-1.25V12c-2.25-.5-4.25 0-5.5 1.5" />,
);

export const CodeIcon = /*#__PURE__*/ createIcon(
  "Code",
  <path d="M5 4.75 1.75 8 5 11.25M11 4.75 14.25 8 11 11.25M9.25 3.5l-2.5 9" />,
);

export const CodeBlockIcon = /*#__PURE__*/ createIcon(
  "CodeBlock",
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.75" />
    <path d="M6.5 5.75 4.25 8l2.25 2.25M9.5 5.75 11.75 8 9.5 10.25" />
  </>,
);

export const ReceiptIcon = /*#__PURE__*/ createIcon(
  "Receipt",
  <>
    <path d="M3.5 14V3.25a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V14l-2.25-1.5L8 14l-2.25-1.5Z" />
    <path d="M6 5.75h4M6 8.5h4" />
  </>,
);

export const TagIcon = /*#__PURE__*/ createIcon(
  "Tag",
  <>
    <path d="M8.3 2.75H3.75a1 1 0 0 0-1 1V8.3a1 1 0 0 0 .3.7l5.5 5.5a1 1 0 0 0 1.4 0l4.1-4.1a1 1 0 0 0 0-1.4L9 3.05a1 1 0 0 0-.7-.3Z" />
    <circle cx="5.75" cy="5.75" r="1" fill="currentColor" stroke="none" />
  </>,
);

export const PaperclipIcon = /*#__PURE__*/ createIcon(
  "Paperclip",
  <path d="M12.75 7.5 8 12.25a3 3 0 0 1-4.25-4.25l5.5-5.5a2 2 0 0 1 2.83 2.83L6.75 10.75a1 1 0 0 1-1.42-1.42L10 4.67" />,
);

/** One chain link, horizontal; the diagonal icons rotate it. */
const LINK_L = "M6.5 5H4.75a3 3 0 0 0 0 6H6.5";
const LINK_R = "M9.5 5h1.75a3 3 0 0 1 0 6H9.5";

export const LinkSimpleIcon = /*#__PURE__*/ createIcon(
  "LinkSimple",
  <path d={`${LINK_L} ${LINK_R} M5.75 8h4.5`} />,
);

export const LinkSimpleBreakIcon = /*#__PURE__*/ createIcon(
  "LinkSimpleBreak",
  <path d={`M6 5H4.75a3 3 0 0 0 0 6H6 M10 5h1.25a3 3 0 0 1 0 6H10`} />,
);

export const LinkIcon = /*#__PURE__*/ createIcon(
  "Link",
  <path
    transform="rotate(-45 8 8)"
    d="M6.75 4.75H4.5a3.25 3.25 0 0 0 0 6.5h2.25M9.25 4.75h2.25a3.25 3.25 0 0 1 0 6.5H9.25M5.75 8h4.5"
  />,
);

export const LinkBreakIcon = /*#__PURE__*/ createIcon(
  "LinkBreak",
  <path
    transform="rotate(-45 8 8)"
    d="M6 4.75H4.5a3.25 3.25 0 0 0 0 6.5H6M10 4.75h1.5a3.25 3.25 0 0 1 0 6.5H10"
  />,
);

export const CalendarBlankIcon = /*#__PURE__*/ createIcon(
  "CalendarBlank",
  <>
    <rect x="2.5" y="3" width="11" height="10.5" rx="1.75" />
    <path d="M2.5 6.75h11M5.5 1.75v2.5M10.5 1.75v2.5" />
  </>,
);

export const TrashIcon = /*#__PURE__*/ createIcon(
  "Trash",
  <path d="M2.5 4.25h11M6.25 4.25v-1c0-.4.35-.75.75-.75h2c.4 0 .75.35.75.75v1M3.75 4.25l.6 8.15c.06.8.72 1.35 1.5 1.35h4.3c.78 0 1.44-.55 1.5-1.35l.6-8.15M6.5 7v4M9.5 7v4" />,
);

export const FlagIcon = /*#__PURE__*/ createIcon(
  "Flag",
  <>
    <path d="M4 14V2.5" />
    <path d="M4 3.5h8.5l-2 3 2 3H4" />
  </>,
  <>
    <path d="M3.4 2.5a.6.6 0 0 1 1.2 0V13.5a.6.6 0 0 1-1.2 0Z" />
    <path d="M4 2.9h9.1l-2.2 3.6 2.2 3.6H4Z" />
  </>,
);

export const FlagCheckeredIcon = /*#__PURE__*/ createIcon(
  "FlagCheckered",
  <>
    <path d="M3.75 14V2.75" />
    <rect x="3.75" y="2.75" width="9.5" height="7" />
    <rect x="8.5" y="2.75" width="4.75" height="3.5" fill="currentColor" stroke="none" />
    <rect x="3.75" y="6.25" width="4.75" height="3.5" fill="currentColor" stroke="none" />
  </>,
);

export const FunnelSimpleIcon = /*#__PURE__*/ createIcon(
  "FunnelSimple",
  <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />,
);

export const FunnelSimpleXIcon = /*#__PURE__*/ createIcon(
  "FunnelSimpleX",
  <>
    <path d="M2.5 4h11M4.5 8h4M6.5 12h1.5" />
    <path d="M10.25 9.75l3 3M13.25 9.75l-3 3" />
  </>,
);

export const MagnifyingGlassIcon = /*#__PURE__*/ createIcon(
  "MagnifyingGlass",
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.25 10.25 13.5 13.5" />
  </>,
);

export const BinocularsIcon = /*#__PURE__*/ createIcon(
  "Binoculars",
  <>
    <rect x="2" y="7.5" width="5.25" height="6.5" rx="2" />
    <rect x="8.75" y="7.5" width="5.25" height="6.5" rx="2" />
    <path d="M3.25 7.5V4h2.75v3.5M10 7.5V4h2.75v3.5M7.25 10.5h1.5" />
  </>,
);

export const CompassIcon = /*#__PURE__*/ createIcon(
  "Compass",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M10.75 5.25 9.5 9.5 5.25 10.75 6.5 6.5Z" />
  </>,
);

export const GlobeIcon = /*#__PURE__*/ createIcon(
  "Globe",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c-1.9 1.75-2.75 3.75-2.75 6S6.1 12.25 8 14c1.9-1.75 2.75-3.75 2.75-6S9.9 3.75 8 2Z" />
  </>,
  (uid) => (
    <>
      <mask id={`m${uid}`}>
        <rect width="16" height="16" fill="white" />
        <path
          d="M2 8h12M8 2c-1.9 1.75-2.75 3.75-2.75 6S6.1 12.25 8 14c1.9-1.75 2.75-3.75 2.75-6S9.9 3.75 8 2Z"
          fill="none"
          stroke="black"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </mask>
      <circle cx="8" cy="8" r="6.6" mask={`url(#m${uid})`} />
    </>
  ),
);

export const GitBranchIcon = /*#__PURE__*/ createIcon(
  "GitBranch",
  <>
    <circle cx="4.5" cy="3.75" r="1.75" />
    <circle cx="4.5" cy="12.25" r="1.75" />
    <circle cx="11.5" cy="5.75" r="1.75" />
    <path d="M4.5 5.5v5M11.5 7.5c0 2-1.25 3-3.25 3H7a2.5 2.5 0 0 0-2.5 2.5" />
  </>,
);

export const TreeStructureIcon = /*#__PURE__*/ createIcon(
  "TreeStructure",
  <>
    <rect x="5.5" y="2" width="5" height="4" rx="1.25" />
    <rect x="1.75" y="10" width="5" height="4" rx="1.25" />
    <rect x="9.25" y="10" width="5" height="4" rx="1.25" />
    <path d="M8 6v2M4.25 10V8h7.5v2" />
  </>,
);
