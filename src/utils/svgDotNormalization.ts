const DOT_EPSILON = 0.5;
const DOT_ADDED_CAP_ATTR = "data-embed-dot-added-linecap";
const DOT_PREV_CAP_ATTR = "data-embed-dot-prev-linecap";

function hasVisibleStroke(path: SVGPathElement): boolean {
  const computed = window.getComputedStyle(path);
  const stroke = path.getAttribute("stroke") ?? computed.stroke;
  if (!stroke || stroke === "none" || stroke === "transparent") return false;

  const strokeWidthRaw = path.getAttribute("stroke-width") ?? computed.strokeWidth;
  const strokeWidth = parseFloat(strokeWidthRaw || "0");
  return Number.isFinite(strokeWidth) && strokeWidth > 0;
}

function isDotLikePath(path: SVGPathElement): boolean {
  try {
    const bbox = path.getBBox();
    return bbox.width < DOT_EPSILON && bbox.height < DOT_EPSILON;
  } catch {
    return false;
  }
}

/**
 * Some icon sets encode tiny dot markers as near-zero length strokes
 * (e.g. `M12 20h.01`). Ensure these remain visible in embed render/edit modes.
 */
export function normalizeTinySvgDotPaths(root: ParentNode): void {
  normalizeTinySvgDotPathsWithOptions(root, { markTemporary: false });
}

export function normalizeTinySvgDotPathsWithOptions(
  root: ParentNode,
  options: { markTemporary: boolean },
): void {
  const paths = root.querySelectorAll("svg path");
  for (const el of paths) {
    if (!(el instanceof SVGPathElement)) continue;
    if (!hasVisibleStroke(el)) continue;
    if (!isDotLikePath(el)) continue;

    const hasExplicitLinecap = el.hasAttribute("stroke-linecap");
    const explicitLinecap = hasExplicitLinecap ? el.getAttribute("stroke-linecap") : null;
    const linecap = explicitLinecap ?? window.getComputedStyle(el).strokeLinecap;
    if (linecap !== "round") {
      if (options.markTemporary) {
        if (hasExplicitLinecap && explicitLinecap != null) {
          el.setAttribute(DOT_PREV_CAP_ATTR, explicitLinecap);
        } else {
          el.setAttribute(DOT_ADDED_CAP_ATTR, "1");
        }
      }
      el.setAttribute("stroke-linecap", "round");
    }
  }
}

/** Remove temporary stroke-linecap overrides created for inline preview only. */
export function stripTinySvgDotPathNormalization(root: ParentNode): void {
  const added = root.querySelectorAll(`svg path[${DOT_ADDED_CAP_ATTR}="1"]`);
  for (const el of added) {
    if (!(el instanceof SVGPathElement)) continue;
    el.removeAttribute("stroke-linecap");
    el.removeAttribute(DOT_ADDED_CAP_ATTR);
  }

  const withPrev = root.querySelectorAll(`svg path[${DOT_PREV_CAP_ATTR}]`);
  for (const el of withPrev) {
    if (!(el instanceof SVGPathElement)) continue;
    const prev = el.getAttribute(DOT_PREV_CAP_ATTR);
    if (prev != null) {
      el.setAttribute("stroke-linecap", prev);
    }
    el.removeAttribute(DOT_PREV_CAP_ATTR);
  }
}
