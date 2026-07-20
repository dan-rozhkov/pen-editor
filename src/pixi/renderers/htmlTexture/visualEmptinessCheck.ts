/**
 * Sample a rendered image/canvas source at a tiny 16×16 size and check
 * whether every pixel is fully transparent. Shared by the SVG inline-render
 * fallback (rich-serialization result may render blank in some browsers) and
 * the foreignObject HTML render fallback (sporadically returns a transparent
 * frame for valid HTML), both of which need to detect a "visually empty"
 * result and fall back to a different render path.
 */
export function isSourceVisuallyEmpty(source: CanvasImageSource): boolean {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 16;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return false;

  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sampleCtx.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height);

  const sample = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  for (let i = 3; i < sample.length; i += 4) {
    if (sample[i] !== 0) return false;
  }
  return true;
}
