/**
 * Shared mutable state for the PixiJS overlay rendering.
 * Updated by pixiInteraction, read by OverlayRenderer.
 * Uses callbacks for reactive updates.
 */

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

let _marqueeRect: MarqueeRect | null = null;

export function getMarqueeRect(): MarqueeRect | null {
  return _marqueeRect;
}

export function setMarqueeRect(rect: MarqueeRect | null): void {
  _marqueeRect = rect;
  for (const fn of listeners) fn();
}

export function subscribeOverlayState(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
