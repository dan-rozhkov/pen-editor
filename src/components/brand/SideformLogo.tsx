import type { SVGProps } from "react";
import {
  SIDEFORM_LOCKUP_VIEWBOX,
  SIDEFORM_MARK_PATH,
  SIDEFORM_MARK_VIEWBOX,
  SIDEFORM_WORDMARK_PATHS,
  type LogoPath,
} from "./sideformLogoPaths";

/**
 * The approved Sideform logo (variant 06). One source for every brand surface:
 * the full lockup (mark + outlined wordmark) and the mark alone for tight spots.
 * Path data is generated from public/brand/*.svg by scripts/generate-sideform-logo.mjs.
 *
 * Colour is `currentColor`, so the logo follows the surrounding text colour and
 * turns white on dark backgrounds with no box behind it. Size it with a height
 * class (`h-6`) — the width follows the viewBox.
 *
 * Accessibility: pass `label` when the logo is the only name of what it sits in
 * (it becomes `role="img"` with that name). Leave it out when the parent already
 * has a name, e.g. a link with `aria-label="Sideform home"` — the SVG is then
 * hidden so a screen reader does not read "Sideform" twice. `role`, the aria
 * naming attributes and focusability are owned by `label` and cannot be overridden by props.
 */
type LogoProps = Omit<
  SVGProps<SVGSVGElement>,
  "viewBox" | "children" | "role" | "aria-hidden" | "aria-label" | "aria-labelledby" | "aria-describedby" | "tabIndex" | "focusable"
> & {
  label?: string;
};

const LOCKUP_PATHS: readonly LogoPath[] = [SIDEFORM_MARK_PATH, ...SIDEFORM_WORDMARK_PATHS];
const MARK_PATHS: readonly LogoPath[] = [SIDEFORM_MARK_PATH];

function LogoSvg({
  kind,
  viewBox,
  paths,
  label,
  ...rest
}: LogoProps & { kind: "lockup" | "mark"; viewBox: { width: number; height: number }; paths: readonly LogoPath[] }) {
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
      {...a11y}
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      data-sideform-logo={kind}
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="currentColor"
          fillRule={p.evenOdd ? "evenodd" : undefined}
          transform={p.x || p.y ? `translate(${p.x},${p.y})` : undefined}
        />
      ))}
    </svg>
  );
}

export function SideformLockup(props: LogoProps) {
  return <LogoSvg kind="lockup" viewBox={SIDEFORM_LOCKUP_VIEWBOX} paths={LOCKUP_PATHS} {...props} />;
}

export function SideformMark(props: LogoProps) {
  return <LogoSvg kind="mark" viewBox={SIDEFORM_MARK_VIEWBOX} paths={MARK_PATHS} {...props} />;
}
