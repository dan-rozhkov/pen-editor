// Shared shape with the backend's `src/ai/prototype-link.ts` — keep in sync.
export interface PrototypeCandidate {
  protoId: string;
  tag: string;
  text: string;
  ariaLabel?: string;
  href?: string;
  /** The element's `class` attribute (whitespace-collapsed, capped) — a
   * strong intent signal for the link-graph reasoner when visible text is
   * thin (icon-only buttons) or generic (`plant-card` → a plant detail). */
  classHint?: string;
}

export interface PrototypeScreenInput {
  id: string;
  name: string;
  content: string;
  candidates: PrototypeCandidate[];
}

export interface PrototypeLink {
  screenId: string;
  protoId: string;
  targetScreenId: string;
}
