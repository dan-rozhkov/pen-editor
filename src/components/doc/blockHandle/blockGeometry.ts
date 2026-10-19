export interface BlockRect {
  /** Document position of the top-level block. */
  pos: number;
  top: number;
  bottom: number;
}

export const HANDLE_SIZE = 24;
/** A pointer within this many px above/below a block still counts as on it (the gap between blocks). */
const GAP = 6;

/** The block under a pointer's y; the nearest one within GAP, else null. */
export function blockAtY(blocks: BlockRect[], y: number): BlockRect | null {
  let best: BlockRect | null = null;
  let bestDistance = Infinity;
  for (const block of blocks) {
    const distance = y < block.top ? block.top - y : y > block.bottom ? y - block.bottom : 0;
    if (distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }
  return bestDistance <= GAP ? best : null;
}

/** Top offset (relative to the container) that centres the handle on the block's first line. */
export function handleTop(blockTop: number, containerTop: number, lineHeight: number): number {
  return blockTop - containerTop + (lineHeight - HANDLE_SIZE) / 2;
}

/** Computed `line-height` as px; "normal" (NaN) falls back to 1.5 × font size. */
export function firstLineHeight(lineHeight: string, fontSize: string): number {
  const line = parseFloat(lineHeight);
  if (Number.isFinite(line)) return line;
  const size = parseFloat(fontSize);
  return (Number.isFinite(size) ? size : 16) * 1.5;
}

/** The top-level child of `root` that contains `target` (or is it); null outside the root. */
export function topLevelChild(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Node ? target : null;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof HTMLElement ? el : null;
}

/** Whether a pointer y is on a block rect, or within the GAP between blocks. */
export function nearBlock(rect: { top: number; bottom: number }, y: number): boolean {
  return blockAtY([{ pos: 0, top: rect.top, bottom: rect.bottom }], y) !== null;
}
