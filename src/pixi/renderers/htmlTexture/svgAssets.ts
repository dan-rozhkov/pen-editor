import { extractCssUrl } from "@/lib/htmlToDesign";
import { loadImage } from "./foreignObject";

export interface PreloadedRenderAssets {
  imageMap: Map<string, HTMLImageElement>;
  svgMap: WeakMap<Element, HTMLImageElement>;
}

function resolveSvgDimensions(svg: SVGSVGElement, clone: SVGSVGElement): { width: number; height: number } {
  const attrWidth = parseFloat(clone.getAttribute("width") || "");
  const attrHeight = parseFloat(clone.getAttribute("height") || "");
  let width = Number.isFinite(attrWidth) && attrWidth > 0 ? attrWidth : 0;
  let height = Number.isFinite(attrHeight) && attrHeight > 0 ? attrHeight : 0;

  const viewBox = clone.getAttribute("viewBox");
  if ((!width || !height) && viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number);
    if (parts.length === 4) {
      if (!width && Number.isFinite(parts[2]) && parts[2] > 0) width = parts[2];
      if (!height && Number.isFinite(parts[3]) && parts[3] > 0) height = parts[3];
    }
  }

  if (!width || !height) {
    const computed = window.getComputedStyle(svg);
    const cssWidth = parseFloat(computed.width || "");
    const cssHeight = parseFloat(computed.height || "");
    if (!width && Number.isFinite(cssWidth) && cssWidth > 0) width = cssWidth;
    if (!height && Number.isFinite(cssHeight) && cssHeight > 0) height = cssHeight;
  }

  if (!width || !height) {
    const rect = svg.getBoundingClientRect();
    if (!width && rect.width > 0) width = rect.width;
    if (!height && rect.height > 0) height = rect.height;
  }

  if (!width) width = 1;
  if (!height) height = 1;

  return { width, height };
}

function serializeSvgWithInlineComputedStyles(svg: SVGSVGElement, styleTexts: string[]): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sourceNodes = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const count = Math.min(sourceNodes.length, cloneNodes.length);
  const ignoredStyleProps = new Set(["visibility", "content-visibility"]);

  for (let i = 0; i < count; i++) {
    const sourceEl = sourceNodes[i] as Element;
    const cloneEl = cloneNodes[i] as Element;
    const computed = window.getComputedStyle(sourceEl);
    const declarations: string[] = [];
    for (let j = 0; j < computed.length; j++) {
      const prop = computed[j];
      if (ignoredStyleProps.has(prop)) continue;
      declarations.push(`${prop}:${computed.getPropertyValue(prop)};`);
    }
    cloneEl.setAttribute("style", declarations.join(""));
  }

  const { width, height } = resolveSvgDimensions(svg, clone);
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  if (styleTexts.length > 0) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = styleTexts.join("\n");
    clone.insertBefore(styleEl, clone.firstChild);
  }

  return new XMLSerializer().serializeToString(clone);
}

function serializeSvgBasic(svg: SVGSVGElement, styleTexts: string[]): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = resolveSvgDimensions(svg, clone);
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  if (styleTexts.length > 0) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = styleTexts.join("\n");
    clone.insertBefore(styleEl, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

async function loadSvgTextAsImage(svgText: string): Promise<HTMLImageElement | null> {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImage(objectUrl, false);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function isImageVisuallyEmpty(image: HTMLImageElement): boolean {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 16;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return false;

  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sampleCtx.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const sample = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  for (let i = 3; i < sample.length; i += 4) {
    if (sample[i] !== 0) return false;
  }
  return true;
}

async function loadInlineSvgAsImage(svg: SVGSVGElement, styleTexts: string[]): Promise<HTMLImageElement | null> {
  const rich = serializeSvgWithInlineComputedStyles(svg, styleTexts);
  const richImage = await loadSvgTextAsImage(rich);
  if (richImage && !isImageVisuallyEmpty(richImage)) return richImage;

  // Fallback for browsers that fail with verbose computed-style serialization.
  const basic = serializeSvgBasic(svg, styleTexts);
  return loadSvgTextAsImage(basic);
}

/** Scan the container for image-like resources and preload them. */
export async function preloadRenderAssets(
  container: HTMLElement,
): Promise<PreloadedRenderAssets> {
  const imageMap = new Map<string, HTMLImageElement>();
  const svgMap = new WeakMap<Element, HTMLImageElement>();
  const urls = new Set<string>();
  const svgs: SVGSVGElement[] = [];
  const styleTexts = Array.from(container.querySelectorAll("style"))
    .map((styleEl) => styleEl.textContent ?? "")
    .filter((text) => text.trim().length > 0);

  const allElements = container.querySelectorAll("*");
  for (const el of allElements) {
    const bgImage = window.getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== "none") {
      const url = extractCssUrl(bgImage);
      if (url) urls.add(url);
    }
    // Also preload <img> element sources
    if (el.tagName === "IMG") {
      const src = (el as HTMLImageElement).src;
      if (src) urls.add(src);
    }
    if (el.tagName.toLowerCase() === "svg") {
      svgs.push(el as SVGSVGElement);
    }
  }
  // Also check the container itself
  const containerBg = window.getComputedStyle(container).backgroundImage;
  if (containerBg && containerBg !== "none") {
    const url = extractCssUrl(containerBg);
    if (url) urls.add(url);
  }

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const img = await loadImage(url);
        imageMap.set(url, img);
      } catch {
        // Skip images that fail CORS-safe loading.
      }
    }),
  );

  await Promise.all(
    svgs.map(async (svgEl) => {
      const svgImg = await loadInlineSvgAsImage(svgEl, styleTexts);
      if (svgImg) {
        svgMap.set(svgEl, svgImg);
      }
    }),
  );

  return { imageMap, svgMap };
}
