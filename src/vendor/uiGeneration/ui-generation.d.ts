export interface UIGenerationOptions {
  /** Light-DOM box the overlay is appended to; the caller positions it over the element. */
  mount: HTMLElement;
  /** ms of drawing; the whole run is about duration × 1.09. Default 2400. */
  duration?: number;
  /** ms before the run starts. Default 0. */
  delay?: number;
  /** Screen px per element px, used for the size/coordinate labels only. Default 1. */
  scale?: number;
  /** Element opacity while the drawing builds. Default 0.35. */
  dim?: number;
  /** Keep the element fully hidden (not dimmed) until the scan line reveals it. Default false. */
  hidden?: boolean;
  /** Edge guides and card corner handles. Default true. Off where they read as the editor's own selection. */
  chrome?: boolean;
  maxParts?: number;
  keys?: number;
  onDone?: (el: HTMLElement) => void;
}

export interface UIGenerationRun {
  /** Resolves when the overlay is gone and the element's inline mask is restored. */
  finished: Promise<HTMLElement>;
  /** Stops at once and restores the element. Safe to call twice. */
  cancel: () => void;
  element: HTMLElement;
}

export function generate(el: HTMLElement, options: UIGenerationOptions): UIGenerationRun;

export interface UIGenerationLiveOptions {
  /** Light-DOM box the overlay is appended to; the caller positions it over the element. */
  mount: HTMLElement;
  /** Screen px per element px at the start. The overlay is measured in screen px at this zoom. */
  scale?: number;
  maxParts?: number;
  keys?: number;
}

export interface UIGenerationLiveRun {
  /** Resolves when the overlay is gone; with the revealed element, or null if `complete` never ran. */
  finished: Promise<HTMLElement | null>;
  /** The zoom the overlay is measured at: the caller scales the mount box by `current / scale`. */
  readonly scale: number;
  readonly element: HTMLElement;
  /** The element changed (more of it streamed in). `el` replaces the element when given. */
  update(scale: number, el?: HTMLElement): void;
  /** Hides `target` at once, then reveals it under the scan line and removes the overlay. */
  complete(target: HTMLElement, scale: number): Promise<HTMLElement | null>;
  /** Takes the overlay out of the page and pauses it. */
  detach(): void;
  /** Puts the overlay into `mount` and resumes. */
  adopt(mount: HTMLElement): void;
  /** Stops at once and restores the target. Safe to call twice. */
  cancel(): void;
}

export function generateLive(el: HTMLElement, options: UIGenerationLiveOptions): UIGenerationLiveRun;
