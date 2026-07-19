/**
 * Pre-capture replacement of Phosphor icon-font elements with inline SVGs.
 *
 * The design agent renders icons as `<i class="ph ph-house"></i>` — the glyph
 * lives entirely in the icon font's `::before`/`::after` content, which the
 * h2d→scene converter has no way to draw on the Pixi canvas (the Phosphor
 * font isn't available there). Swapping each icon element's glyph for the
 * matching `@phosphor-icons/core` SVG *inside the capture iframe* lets the
 * existing SVG capture path turn icons into data-URL image fills instead of
 * dropping them.
 *
 * Failure is always per-icon: an icon whose SVG can't be fetched or applied
 * is left untouched (it drops, as before) and never fails the conversion.
 */

import { px } from "@/lib/h2dPaste/h2dToScene";

/** Weight classes as used by @phosphor-icons/web; `ph` alone means regular. */
const WEIGHT_CLASSES = {
  ph: "regular",
  "ph-thin": "thin",
  "ph-light": "light",
  "ph-bold": "bold",
  "ph-fill": "fill",
  "ph-duotone": "duotone",
} as const;

type PhosphorWeight = (typeof WEIGHT_CLASSES)[keyof typeof WEIGHT_CLASSES];

/**
 * Matches the core package version to the `@phosphor-icons/web@2.1.1` CSS the
 * agent emits (see pen-editor-backend/src/skills/prototype.md, "Icon rules") —
 * bump both together or icons added in newer Phosphor versions will 404 here
 * while still rendering in the live embed.
 */
const PHOSPHOR_CORE_BASE = "https://unpkg.com/@phosphor-icons/core@2.1.1/assets";

export interface PhosphorIconRef {
  name: string;
  weight: PhosphorWeight;
}

/**
 * Extract `{name, weight}` from a class list like `["ph", "ph-house"]`.
 * Requires both a weight class and an icon-name class; the name is validated
 * to `[a-z0-9-]` since it is interpolated into a URL path.
 */
export function parsePhosphorIconClasses(
  classList: readonly string[],
): PhosphorIconRef | null {
  let weight: PhosphorWeight | null = null;
  let name: string | null = null;
  for (const cls of classList) {
    if (cls in WEIGHT_CLASSES) {
      weight = WEIGHT_CLASSES[cls as keyof typeof WEIGHT_CLASSES];
      continue;
    }
    if (/^ph-[a-z0-9-]+$/.test(cls)) name = cls.slice(3);
  }
  if (!weight || !name) return null;
  return { name, weight };
}

export function phosphorSvgUrl(icon: PhosphorIconRef): string {
  const file =
    icon.weight === "regular" ? icon.name : `${icon.name}-${icon.weight}`;
  return `${PHOSPHOR_CORE_BASE}/${icon.weight}/${file}.svg`;
}

/** Cross-conversion cache of successfully fetched SVG markup. */
const svgTextCache = new Map<string, Promise<string | null>>();

async function defaultFetchSvgText(url: string): Promise<string | null> {
  const cached = svgTextCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      // An empty 200 body is a failure too — there is no icon to inline.
      return (await response.text()) || null;
    } catch {
      return null;
    }
  })();
  svgTextCache.set(url, promise);
  const text = await promise;
  // Don't cache failures across conversions — a transient network error
  // shouldn't permanently blank this icon for the session.
  if (text === null) svgTextCache.delete(url);
  return text;
}

const SUPPRESS_ATTR = "data-ph-svg-icon";

/** One selector per weight token — `~=` matches whole class tokens only. */
const CANDIDATE_SELECTOR = Object.keys(WEIGHT_CLASSES)
  .map((cls) => `[class~="${cls}"]`)
  .join(",");

/**
 * Replace every Phosphor icon element's font glyph in `doc` with the matching
 * inline SVG, sized to the element's font-size and filled with its computed
 * color. Both glyph pseudo-elements are suppressed via a document-level rule
 * (duotone icons render layers in `::before` AND `::after`) so the capture
 * doesn't double-report the icon.
 */
export async function inlinePhosphorIconSvgs(
  doc: Document,
  fetchSvgText: (url: string) => Promise<string | null> = defaultFetchSvgText,
): Promise<void> {
  // Group candidates by asset URL so each distinct icon is fetched once,
  // regardless of which fetcher is in use.
  const byUrl = new Map<string, Element[]>();
  for (const el of doc.querySelectorAll(CANDIDATE_SELECTOR)) {
    const icon = parsePhosphorIconClasses(Array.from(el.classList));
    if (!icon) continue;
    const url = phosphorSvgUrl(icon);
    const group = byUrl.get(url);
    if (group) group.push(el);
    else byUrl.set(url, [el]);
  }
  if (byUrl.size === 0) return;

  let suppressionRuleAdded = false;
  const view = doc.defaultView ?? window;

  await Promise.all(
    Array.from(byUrl, async ([url, els]) => {
      const svgText = await fetchSvgText(url);
      if (!svgText) return;

      for (const el of els) {
        // Per-icon isolation: a single unprocessable element must degrade to
        // "this icon drops" (the pre-fix behavior), never fail the capture.
        try {
          const holder = doc.createElement("div");
          holder.innerHTML = svgText;
          const svg = holder.firstElementChild;
          if (!svg || svg.tagName.toLowerCase() !== "svg") continue;

          const computed = view.getComputedStyle(el);
          const fontSize = px(computed.fontSize);
          // font-size: 0 hides the glyph — keep the icon hidden.
          if (fontSize !== null && fontSize <= 0) continue;
          const size = fontSize ?? 16;
          svg.setAttribute("width", String(size));
          svg.setAttribute("height", String(size));
          if (computed.color) svg.setAttribute("fill", computed.color);
          // Block display removes the inline-baseline gap so the svg fills
          // the icon element's box the way the glyph did.
          (svg as SVGElement).style.display = "block";

          if (!suppressionRuleAdded) {
            const style = doc.createElement("style");
            style.textContent =
              `[${SUPPRESS_ATTR}]::before { content: none !important; }\n` +
              `[${SUPPRESS_ATTR}]::after { content: none !important; }`;
            doc.head.appendChild(style);
            suppressionRuleAdded = true;
          }
          el.setAttribute(SUPPRESS_ATTR, "");
          el.appendChild(svg);
        } catch {
          // Leave this element untouched; keep going with the rest.
        }
      }
    }),
  );
}
