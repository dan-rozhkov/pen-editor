const EMBED_PREFLIGHT_STYLE_ID = "embed-tailwind-preflight";
const EMBED_PREFLIGHT_ROOT_CLASS = "ck-preflight-root";
const EMBED_PREFLIGHT_CSS = `
.${EMBED_PREFLIGHT_ROOT_CLASS}, .${EMBED_PREFLIGHT_ROOT_CLASS} *, .${EMBED_PREFLIGHT_ROOT_CLASS}::before, .${EMBED_PREFLIGHT_ROOT_CLASS}::after{
  box-sizing:border-box;
  border:0 solid;
}
.${EMBED_PREFLIGHT_ROOT_CLASS}{
  line-height:1.5;
  -webkit-text-size-adjust:100%;
  tab-size:4;
  font-family:Inter, ui-sans-serif, system-ui, sans-serif;
  font-feature-settings:normal;
  font-variation-settings:normal;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(hr){
  height:0;
  color:inherit;
  border-top-width:1px;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(abbr[title]){
  text-decoration:underline dotted;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(h1, h2, h3, h4, h5, h6){
  font-size:inherit;
  font-weight:inherit;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(a){
  color:inherit;
  text-decoration:inherit;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(b, strong){
  font-weight:bolder;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(code, kbd, samp, pre){
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-feature-settings:normal;
  font-variation-settings:normal;
  font-size:1em;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(small){
  font-size:80%;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(sub, sup){
  font-size:75%;
  line-height:0;
  position:relative;
  vertical-align:baseline;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(sub){ bottom:-0.25em; }
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(sup){ top:-0.5em; }
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(table){
  text-indent:0;
  border-color:inherit;
  border-collapse:collapse;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(button, input, optgroup, select, textarea){
  font:inherit;
  font-feature-settings:inherit;
  font-variation-settings:inherit;
  letter-spacing:inherit;
  color:inherit;
  margin:0;
  padding:0;
  background-color:transparent;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(button, select){
  text-transform:none;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(button, input[type="button"], input[type="reset"], input[type="submit"]){
  -webkit-appearance:button;
  appearance:button;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(progress){
  vertical-align:baseline;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(::-webkit-search-decoration){
  -webkit-appearance:none;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(::-webkit-file-upload-button){
  -webkit-appearance:button;
  appearance:button;
  font:inherit;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(summary){
  display:list-item;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre){
  margin:0;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(fieldset){
  margin:0;
  padding:0;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(legend){
  padding:0;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(ol, ul, menu){
  list-style:none;
  margin:0;
  padding:0;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(dialog){
  padding:0;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(textarea){
  resize:vertical;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(input::placeholder, textarea::placeholder){
  opacity:1;
  color:color-mix(in oklab, currentColor 50%, transparent);
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(button, [role="button"]){
  cursor:pointer;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(:disabled){
  cursor:default;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(img, svg, video, canvas, audio, iframe, embed, object){
  display:block;
  vertical-align:middle;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where(img, video){
  max-width:100%;
  height:auto;
}
.${EMBED_PREFLIGHT_ROOT_CLASS} :where([hidden]:not([hidden="until-found"])){
  display:none !important;
}
`;

export function normalizeHtmlForEmbedRender(html: string): string {
  // Fast path: skip DOM round-trip when no fixed positioning is present
  try {
    const container = document.createElement("div");
    container.innerHTML = html;

    if (!container.querySelector(`style[data-embed-style="${EMBED_PREFLIGHT_STYLE_ID}"]`)) {
      const style = document.createElement("style");
      style.setAttribute("data-embed-style", EMBED_PREFLIGHT_STYLE_ID);
      style.textContent = EMBED_PREFLIGHT_CSS;
      container.insertBefore(style, container.firstChild);
    }

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
    <div xmlns="http://www.w3.org/1999/xhtml" class="${EMBED_PREFLIGHT_ROOT_CLASS}" style="width:${width}px;height:${height}px;overflow:hidden;">
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
