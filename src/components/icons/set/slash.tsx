import type { ReactNode } from "react";

/** Slash cut flat through a glyph: the glyph is masked, the slash drawn on top. */
export function slashed(uid: string, tag: string, glyph: ReactNode): ReactNode {
  return (
    <>
      <mask id={`m${tag}${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <rect x="0" y="0" width="16" height="16" fill="white" stroke="none" />
        {/* Screen-space like the slash itself (non-scaling stroke), so the
            gap is 1.25px either side at every size. */}
        <path d="M2.5 2.5l11 11" stroke="black" strokeWidth="3.75" />
      </mask>
      <g mask={`url(#m${tag}${uid})`}>{glyph}</g>
      <path d="M2.5 2.5l11 11" />
    </>
  );
}
