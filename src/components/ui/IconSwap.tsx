import * as React from "react";

export interface IconSwapProps {
  /** Which icon is "on top" — `true` shows `activeIcon`, `false` shows `inactiveIcon`. */
  active: boolean;
  /** Icon shown when `active` is `true`. */
  activeIcon: React.ReactNode;
  /** Icon shown when `active` is `false`. */
  inactiveIcon: React.ReactNode;
  className?: string;
}

/**
 * Cross-fades between two icons instead of swapping them instantly.
 *
 * Both icons stay mounted in the DOM at all times: `activeIcon` sits in
 * normal flow (sizing the `relative` `inline-flex` container by content)
 * while `inactiveIcon` is absolutely positioned on top of it — so the swap
 * gets both an enter and an exit transition without a motion library
 * (there isn't one in this repo).
 *
 * Transition is exactly three properties — `scale` (0.25 → 1), `opacity`
 * (0 → 1) and `filter: blur(4px)` (→ `blur(0px)`) — named explicitly via
 * `transition-property` (never `transition-all`), eased with
 * `cubic-bezier(0.2, 0, 0, 1)` over `var(--duration-fast)` (250ms), declared
 * via the `icon-swap-transition` CSS utility (`src/index.css`) rather than
 * inline styles so `prefers-reduced-motion: reduce` can actually override
 * it — an inline `transitionProperty`/`-Duration`/`-TimingFunction` would
 * always beat a `motion-reduce:` utility class in specificity.
 *
 * The icon that isn't showing is `aria-hidden` and `pointer-events-none` so
 * assistive tech only ever sees one icon and clicks can't land on the
 * fading-out one. This is purely a visual affordance — any
 * `aria-label`/`title`/tooltip that already communicates the state change
 * must stay on the trigger element wrapping this component; motion is
 * never the only signal.
 */
export function IconSwap({ active, activeIcon, inactiveIcon, className }: IconSwapProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ""}`}>
      <IconLayer visible={active}>{activeIcon}</IconLayer>
      <IconLayer visible={!active} overlay>
        {inactiveIcon}
      </IconLayer>
    </span>
  );
}

function IconLayer({
  visible,
  overlay,
  children,
}: {
  visible: boolean;
  overlay?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden={!visible}
      className={`flex items-center justify-center icon-swap-transition ${
        overlay ? "absolute inset-0" : ""
      }`}
      style={{
        scale: visible ? 1 : 0.25,
        opacity: visible ? 1 : 0,
        filter: visible ? "blur(0px)" : "blur(4px)",
        pointerEvents: visible ? undefined : "none",
      }}
    >
      {children}
    </span>
  );
}
