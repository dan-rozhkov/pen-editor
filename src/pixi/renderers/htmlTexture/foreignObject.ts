export function normalizeHtmlForEmbedRender(html: string): string {
  // Fast path: skip DOM round-trip when no fixed positioning is present
  if (!html.includes("fixed")) return html;
  try {
    const container = document.createElement("div");
    container.innerHTML = html;

    const allElements = container.querySelectorAll<HTMLElement>("*");
    for (const el of allElements) {
      if (el.style.position === "fixed") {
        el.style.position = "absolute";
      }
    }

    return container.innerHTML;
  } catch {
    return html;
  }
}

function isCanvasVisuallyEmpty(canvas: HTMLCanvasElement): boolean {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 16;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return false;

  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sampleCtx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

  const sample = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  for (let i = 3; i < sample.length; i += 4) {
    if (sample[i] !== 0) return false;
  }
  return true;
}

export async function renderViaForeignObject(
  html: string,
  width: number,
  height: number,
  pixelWidth: number,
  pixelHeight: number,
  resolution: number,
): Promise<HTMLCanvasElement | null> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
      ${html}
    </div>
  </foreignObject>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.scale(resolution, resolution);
    ctx.drawImage(img, 0, 0, width, height);

    // Ensure canvas is not tainted before passing to Pixi/WebGL.
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      return null;
    }

    // Browser foreignObject rasterization can sporadically return a transparent frame
    // for valid HTML (especially under rapid rerenders). Treat it as a failed render
    // so caller can use the deterministic DOM-walk fallback.
    if (isCanvasVisuallyEmpty(canvas)) {
      return null;
    }

    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(url: string, useCors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}
