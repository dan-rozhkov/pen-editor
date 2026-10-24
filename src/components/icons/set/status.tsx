import type { ReactNode } from "react";
import { createIcon } from "../createIcon";
import { slashed } from "./slash";

// Status, feedback and small UI marks: check/x/plus, alerts, eye, chat,
// grips, brand marks.

/** Solid shape (already grown by half a stroke) with `mark` cut out. */
function cut(uid: string, tag: string, solid: ReactNode, mark: ReactNode): ReactNode {
  return (
    <>
      <mask id={`m${tag}${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <g fill="white" stroke="white" strokeWidth="1.25">
          {solid}
        </g>
        <g fill="none" stroke="black" strokeWidth="1.25">
          {mark}
        </g>
      </mask>
      <rect x="0" y="0" width="16" height="16" mask={`url(#m${tag}${uid})`} stroke="none" />
    </>
  );
}

const DOT = { fill: "currentColor", stroke: "none" } as const;

export const PlusIcon = /*#__PURE__*/ createIcon("Plus", <path d="M8 2.75v10.5M2.75 8h10.5" />);

export const XIcon = /*#__PURE__*/ createIcon("X", <path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" />);

export const CheckIcon = /*#__PURE__*/ createIcon("Check", <path d="M2.75 8.5l3.25 3.25 7.25-7.5" />);

export const MinusIcon = /*#__PURE__*/ createIcon("Minus", <path d="M2.75 8h10.5" />);

const RING = <circle cx="8" cy="8" r="6" />;

const CHECK_MARK = <path d="M5.25 8.25l2 2 3.5-4" />;
const X_MARK = <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />;
const BANG_MARK = <path d="M8 4.75v3.5M8 11v.01" />;

export const CheckCircleIcon = /*#__PURE__*/ createIcon(
  "CheckCircle",
  <>
    {RING}
    {CHECK_MARK}
  </>,
  (uid) => cut(uid, "CheckCircle", RING, CHECK_MARK),
);

export const XCircleIcon = /*#__PURE__*/ createIcon(
  "XCircle",
  <>
    {RING}
    {X_MARK}
  </>,
  (uid) => cut(uid, "XCircle", RING, X_MARK),
);

export const PlusCircleIcon = /*#__PURE__*/ createIcon(
  "PlusCircle",
  <>
    {RING}
    <path d="M8 5.25v5.5M5.25 8h5.5" />
  </>,
);

const INFO_MARK = <path d="M8 11.25v-3.5M8 5.25v.01" />;

export const InfoIcon = /*#__PURE__*/ createIcon(
  "Info",
  <>
    {RING}
    {INFO_MARK}
  </>,
  (uid) => cut(uid, "Info", RING, INFO_MARK),
);

export const QuestionIcon = /*#__PURE__*/ createIcon(
  "Question",
  <>
    {RING}
    <path d="M6.25 6.5a1.75 1.75 0 1 1 2.6 1.53C8.3 8.4 8 8.8 8 9.5M8 11.5v.01" />
  </>,
);

const TRI = "M8 2.75L14 13H2Z";
const TRI_MARK = <path d="M8 6.5v3M8 11.25v.01" />;

export const WarningIcon = /*#__PURE__*/ createIcon(
  "Warning",
  <>
    <path d={TRI} />
    {TRI_MARK}
  </>,
  (uid) => cut(uid, "Warning", <path d={TRI} />, TRI_MARK),
);

export const WarningCircleIcon = /*#__PURE__*/ createIcon(
  "WarningCircle",
  <>
    {RING}
    {BANG_MARK}
  </>,
  (uid) => cut(uid, "WarningCircle", RING, BANG_MARK),
);

const OCT = "M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6Z";

export const WarningOctagonIcon = /*#__PURE__*/ createIcon(
  "WarningOctagon",
  <>
    <path d={OCT} />
    {BANG_MARK}
  </>,
  (uid) => cut(uid, "WarningOctagon", <path d={OCT} />, BANG_MARK),
);

const EYE = "M1.75 8C3 5.25 5.25 3.75 8 3.75S13 5.25 14.25 8C13 10.75 10.75 12.25 8 12.25S3 10.75 1.75 8Z";
// Slashed eye: the pupil would sit under the slash and leave crumbs, so the
// base glyph is the lens alone, a touch fuller.
const EYE_LENS = "M1.75 8C3.25 4.75 5.5 3.25 8 3.25S12.75 4.75 14.25 8C12.75 11.25 10.5 12.75 8 12.75S3.25 11.25 1.75 8Z";

export const EyeIcon = /*#__PURE__*/ createIcon(
  "Eye",
  <>
    <path d={EYE} />
    <circle cx="8" cy="8" r="1.75" />
  </>,
);

export const EyeSlashIcon = /*#__PURE__*/ createIcon("EyeSlash", (uid) =>
  slashed(uid, "EyeSlash",
    <path d={EYE_LENS} />,
  ),
);

const HEART = "M8 13.25S2.25 10.1 2.25 6.1a3.1 3.1 0 0 1 5.75-1.6 3.1 3.1 0 0 1 5.75 1.6c0 4-5.75 7.15-5.75 7.15Z";

export const HeartIcon = /*#__PURE__*/ createIcon(
  "Heart",
  <path d={HEART} />,
  <path d={HEART} stroke="currentColor" />,
);

const SPARKLE = "M8 2.25Q8.6 7.4 13.75 8Q8.6 8.6 8 13.75Q7.4 8.6 2.25 8Q7.4 7.4 8 2.25Z";

export const SparkleIcon = /*#__PURE__*/ createIcon(
  "Sparkle",
  <path d={SPARKLE} />,
  <path d={SPARKLE} stroke="currentColor" />,
);

export const LightningIcon = /*#__PURE__*/ createIcon("Lightning", <path d="M9 2L3.75 9H8l-1 5 5.25-7H8Z" />);

const BULB = "M5.5 11.25V10.6C4.4 9.8 3.75 8.5 3.75 7.1a4.25 4.25 0 0 1 8.5 0c0 1.4-.65 2.7-1.75 3.5v.65Z";

export const LightbulbIcon = /*#__PURE__*/ createIcon(
  "Lightbulb",
  <>
    <path d={BULB} />
    <path d="M6.25 13.5h3.5" />
  </>,
  <>
    <path d={BULB} stroke="currentColor" />
    <path d="M6.25 13.5h3.5" stroke="currentColor" />
  </>,
);

const HORN = "M2.5 6.25h3L12.5 3v10l-7-3.25h-3Z";

export const MegaphoneIcon = /*#__PURE__*/ createIcon(
  "Megaphone",
  <>
    <path d={HORN} />
    <path d="M5.25 10l.9 3h1.6" />
  </>,
  <>
    <path d={HORN} stroke="currentColor" />
    <path d="M5.25 10l.9 3h1.6" stroke="currentColor" />
  </>,
);

const BRAIN_L = "M8 3.5A1.75 1.75 0 0 0 4.9 4.6 1.95 1.95 0 0 0 3.4 8 2.2 2.2 0 0 0 5 12 1.6 1.6 0 0 0 8 12.5Z";
const BRAIN_R = "M8 3.5A1.75 1.75 0 0 1 11.1 4.6 1.95 1.95 0 0 1 12.6 8 2.2 2.2 0 0 1 11 12 1.6 1.6 0 0 1 8 12.5Z";

export const BrainIcon = /*#__PURE__*/ createIcon(
  "Brain",
  <>
    <path d={BRAIN_L} />
    <path d={BRAIN_R} />
  </>,
);

const BUBBLE = "M2.5 13.5L2.8 11A6 6 0 1 1 5.95 13.64Z";

export const ChatCircleIcon = /*#__PURE__*/ createIcon("ChatCircle", <path d={BUBBLE} />);

export const ChatCircleDotsIcon = /*#__PURE__*/ createIcon(
  "ChatCircleDots",
  <>
    <path d={BUBBLE} />
    <circle cx="5.2" cy="8" r="0.85" {...DOT} />
    <circle cx="8" cy="8" r="0.85" {...DOT} />
    <circle cx="10.8" cy="8" r="0.85" {...DOT} />
  </>,
);

export const ChatCircleTextIcon = /*#__PURE__*/ createIcon(
  "ChatCircleText",
  <>
    <path d={BUBBLE} />
    <path d="M5.5 6.5h5M5.5 9.25h3" />
  </>,
);

const PERSON = (
  <>
    <circle cx="8" cy="6.5" r="1.75" />
    <path d="M4.75 12c.5-1.4 1.8-2.1 3.25-2.1s2.75.7 3.25 2.1" />
  </>
);

export const UserCircleIcon = /*#__PURE__*/ createIcon(
  "UserCircle",
  <>
    {RING}
    {PERSON}
  </>,
  (uid) => cut(uid, "UserCircle", RING, PERSON),
);

export const DotsSixIcon = /*#__PURE__*/ createIcon(
  "DotsSix",
  <>
    {[3.5, 8, 12.5].flatMap((x) =>
      [6, 10].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" {...DOT} />),
    )}
  </>,
);

export const DotsSixVerticalIcon = /*#__PURE__*/ createIcon(
  "DotsSixVertical",
  <>
    {[5.75, 10.25].flatMap((x) =>
      [3.75, 8, 12.25].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" {...DOT} />),
    )}
  </>,
);

export const DotsThreeVerticalIcon = /*#__PURE__*/ createIcon(
  "DotsThreeVertical",
  <>
    {[3.5, 8, 12.5].map((y) => (
      <circle key={y} cx="8" cy={y} r="1" {...DOT} />
    ))}
  </>,
);

const CLOUD = "M4.5 12.75a3.25 3.25 0 0 1-.6-6.45 4.25 4.25 0 0 1 8.2.7 2.9 2.9 0 0 1-.6 5.75Z";

export const CloudSlashIcon = /*#__PURE__*/ createIcon("CloudSlash", (uid) => slashed(uid, "CloudSlash", <path d={CLOUD} />));

export const WifiSlashIcon = /*#__PURE__*/ createIcon("WifiSlash", (uid) =>
  slashed(uid, "WifiSlash",
    <>
      <path d="M2.06 7.61A6.5 6.5 0 0 1 13.94 7.61" />
      <path d="M5.13 9.09A3.1 3.1 0 0 1 10.87 9.09" />
      <circle cx="8" cy="10.25" r="0.95" {...DOT} />
    </>,
  ),
);

const APPLE =
  "M8 6.25C7 5.2 3.5 5.4 3.5 9c0 2.6 1.6 5 3 5 .7 0 1-.4 1.5-.4s.8.4 1.5.4c1.2 0 2.4-1.5 2.9-2.9a2.1 2.1 0 0 1-.9-3.3c.3-.4.6-.6.9-.8C11.5 5.6 9.2 5.5 8 6.25Z";
const APPLE_LEAF = "M8.4 4C8.3 2.8 9.2 2 10.5 1.9c.1 1.2-.7 2.1-2.1 2.1Z";

export const AppleLogoIcon = /*#__PURE__*/ createIcon(
  "AppleLogo",
  <>
    <path d={APPLE} />
    <path d={APPLE_LEAF} />
  </>,
  <>
    <path d={APPLE} stroke="currentColor" />
    <path d={APPLE_LEAF} stroke="currentColor" />
  </>,
);

export const GithubLogoIcon = /*#__PURE__*/ createIcon(
  "GithubLogo",
  <>
    <path d="M3.5 2.75L6.2 3.85A4.6 4.6 0 0 1 9.8 3.85L12.5 2.75Q13.1 4.7 12.2 6.4A4.6 4.6 0 1 1 3.8 6.4Q2.9 4.7 3.5 2.75Z" />
    <path d="M6.6 12.9c-2.1.8-2.6-.9-4.1-.9" />
  </>,
);

export const MobbinIcon = /*#__PURE__*/ createIcon(
  "Mobbin",
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.25 10.75v-5.5L8 8.25l2.75-3v5.5" />
  </>,
);
