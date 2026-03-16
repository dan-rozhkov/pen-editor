import type { Container } from "pixi.js";

/**
 * Recursively find a PixiJS container by its label (node ID).
 */
export function findPixiChild(
  parent: Container,
  label: string,
): Container | null {
  if (parent.label === label) return parent;
  for (const child of parent.children) {
    const found = findPixiChild(child as Container, label);
    if (found) return found;
  }
  return null;
}
