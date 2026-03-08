export interface MeasuredNodeContents {
  bounds: DOMRect;
  rectCount: number;
}

export function measureNodeContents(node: Node): MeasuredNodeContents | null {
  const range = document.createRange();
  range.selectNodeContents(node);

  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) return null;

  let minX = rects[0].left;
  let minY = rects[0].top;
  let maxX = rects[0].right;
  let maxY = rects[0].bottom;

  for (let i = 1; i < rects.length; i++) {
    const rect = rects[i];
    minX = Math.min(minX, rect.left);
    minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.right);
    maxY = Math.max(maxY, rect.bottom);
  }

  return {
    bounds: new DOMRect(minX, minY, maxX - minX, maxY - minY),
    rectCount: rects.length,
  };
}
