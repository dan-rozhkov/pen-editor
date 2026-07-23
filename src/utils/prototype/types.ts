// Shared shape with the backend's `src/ai/prototype-link.ts` — keep in sync.
export interface PrototypeCandidate {
  protoId: string;
  tag: string;
  text: string;
  ariaLabel?: string;
  href?: string;
}

export interface PrototypeScreenInput {
  id: string;
  name: string;
  candidates: PrototypeCandidate[];
}

export interface PrototypeLink {
  screenId: string;
  protoId: string;
  targetScreenId: string;
}
