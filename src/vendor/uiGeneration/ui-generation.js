/*
 * transitions.dev / UI generation — adapted for the pen-editor canvas.
 *
 * Upstream: https://github.com/Jakubantalik/transitions.dev
 *   skills/transitions-ui-generation/ui-generation.js (Transitions.dev License, see LICENSE.txt).
 *
 * Plays an "agent is generating this" pass over an element, built from the element's own structure:
 * a dot field ripples out, construction guides and corner handles appear, the outline and every part
 * (boxes, text lines, icon paths) are traced in small flowing dots, then a scan line sweeps down.
 *
 * Local changes against upstream (keep this list current when re-syncing):
 *   1. Only the `ui` variant in `skeleton` mode. The text/image variants and the generation-texts
 *      panels are removed.
 *   2. The overlay is appended to `options.mount` (a light-DOM box the caller positions over the
 *      element), not to `document.body` at a frozen page offset. The caller keeps that box in sync
 *      with pan/zoom.
 *   3. The element is never hidden. It is dimmed with a CSS mask to `options.dim` while the drawing
 *      builds, and the scan line restores it to full opacity from the top down. Upstream hides the
 *      element (opacity 0 + clip-path), which suits a first appearance, not a screen the user already
 *      watched stream in.
 *   4. `options.scale` (screen px per element px) converts the size/coordinate labels back to the
 *      element's own units, so a 390×844 screen reads 390 × 844 at any zoom.
 *   5. The dot-field spacing grows on large elements (at most ~MAX_DOTS dots), and parts outside the
 *      element's visible box (scrolled-off content) are skipped.
 *   6. `prefers-reduced-motion`: nothing is drawn and the element is left as it is.
 *   7. The element's size label sits under it, not above: the canvas already draws the frame name there.
 *   8. `options.hidden`: the element is kept fully hidden (not dimmed) until the scan line reveals it.
 *   9. `generateLive`: an open-ended run for an element that is still being written (a streaming
 *      screen). Parts are traced as they appear, and `complete()` later runs the scan line over the
 *      finished element. The overlay can move to another mount between the two (`detach`/`adopt`).
 *      It draws no edge guides, card handles or key elements: in an editor they look like the
 *      layer's selection outline and resize handles. Not in upstream.
 */

const NS = "http://www.w3.org/2000/svg";

// ─── timing: phases of a build, as fractions of `duration` (the reveal runs a little past 1) ───
const PH = {
  dots: [0, 0.3], probe: [0.02, 0.24], guides: [0.04, 0.3], outline: [0.1, 0.42],
  parts: [0.28, 0.74], reveal: [0.74, 1.055], clean: [0.84, 1.04],
};
const END = 1.09; // the build is over (and the overlay removed) at duration × END
const MAX_DOTS = 2600;

const DEFAULTS = {
  chrome: true,              // edge guides and card corner handles (off where they read as the editor's own)
  hidden: false,             // (local change 8) keep the element hidden, not dimmed, until the scan line
  duration: 2400,            // ms for the drawing; the whole run is about duration × 1.09
  delay: 0,                  // ms before it starts
  maxParts: 60,              // most parts traced (largest first when there are more)
  keys: 5,                   // key elements that get guides, handles and a size label
  scale: 1,                  // screen px per element px (labels only)
  dim: 0.35,                 // element opacity while the drawing builds
  mount: null,               // required: where the overlay goes
  onDone: null,
};

// ─── small math ───
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (a, b, x) => { const q = clamp((x - a) / (b - a)); return q * q * (3 - 2 * q); };
const win = (r, p) => clamp((p - r[0]) / (r[1] - r[0]));
const f2 = (n) => (+n).toFixed(2);
const hashN = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function bezier(x1, y1, x2, y2) {
  const cx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, m = 0.5; for (let i = 0; i < 28; i++) { m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; } return cy(m); };
}
const OUT = bezier(0.16, 1, 0.3, 1);          // drawing: a soft, quick-settling ease-out
const SMOOTH_OUT = bezier(0.22, 1, 0.36, 1);  // reveal: --ease-smooth-out

function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function rrPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f2(x + r)} ${f2(y)}H${f2(x + w - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w)} ${f2(y + r)}V${f2(y + h - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w - r)} ${f2(y + h)}H${f2(x + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x)} ${f2(y + h - r)}V${f2(y + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + r)} ${f2(y)}Z`;
}
// half an outline, from top centre to bottom centre, clockwise (dir 1) or counter-clockwise (dir 0)
function rrHalf(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const X = (v) => f2(x + v), Y = (v) => f2(y + v), R = f2(r);
  return dir
    ? `M${X(w / 2)} ${Y(0)}H${X(w - r)}A${R} ${R} 0 0 1 ${X(w)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 1 ${X(w - r)} ${Y(h)}H${X(w / 2)}`
    : `M${X(w / 2)} ${Y(0)}H${X(r)}A${R} ${R} 0 0 0 ${X(0)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 0 ${X(r)} ${Y(h)}H${X(w / 2)}`;
}
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── 1. read the element: boxes, text lines, icon geometry, key elements (screen px) ───
function measure(el, opts) {
  const R = el.getBoundingClientRect(), area = R.width * R.height, parts = [];
  const rel = (r) => ({ x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height });
  // (local change 5) content scrolled out of the element's box is not drawn
  const offBox = (r) => r.bottom <= R.top || r.top >= R.bottom || r.right <= R.left || r.left >= R.right;
  const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return c && c !== "transparent" ? 1 : 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; };
  const hidden = (n) => { for (let x = n; x && x !== el; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return true; } return false; };
  // the card's radius: its own, or that of a child that fills it
  let radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const walk = (node) => {
    for (const c of node.children) {
      if (c.matches("script, style, template, link, meta, [data-t-generate-skip]") || hidden(c)) continue;
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      if (!r.width || !r.height) { walk(c); continue; }
      if (offBox(r)) continue;
      if (Math.abs(r.width - R.width) < 2 && Math.abs(r.height - R.height) < 2) radius = Math.max(radius, parseFloat(cs.borderTopLeftRadius) || 0);
      if (c instanceof SVGSVGElement) {
        if (r.width <= 120 && r.height <= 120) {
          const paths = [];
          for (const g of c.querySelectorAll("path, circle, ellipse, rect, line, polyline, polygon")) {
            if (g.closest("defs, clipPath, mask, symbol") || hidden(g)) continue;
            const m = g.getScreenCTM(); if (!m) continue;
            const attrs = {}; for (const a of ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"]) if (g.hasAttribute(a)) attrs[a] = g.getAttribute(a);
            paths.push({ tag: g.tagName.toLowerCase(), attrs, m: [m.a, m.b, m.c, m.d, m.e - R.left, m.f - R.top] });
          }
          if (paths.length) parts.push({ kind: "icon", ...rel(r), paths, name: "svg", el: c });
        }
        continue;
      }
      const big = r.width * r.height > area * 0.6, blurred = /blur/.test(cs.filter);
      const boxy = !big && !blurred && (alpha(cs.backgroundColor) > 0.02 || parseFloat(cs.borderTopWidth) > 0 || /^(IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(c.tagName) || cs.backgroundImage !== "none");
      if (boxy) {
        const interactive = /^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(c.tagName) || /button|tab|switch|checkbox|slider/.test(c.getAttribute("role") || "");
        const name = c.tagName === "INPUT" || c.tagName === "TEXTAREA" ? "input" : c.tagName === "BUTTON" || c.getAttribute("role") === "button" ? "button" : /^(IMG|CANVAS|VIDEO)$/.test(c.tagName) ? "image" : "frame";
        parts.push({ kind: "box", ...rel(r), r: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2), interactive, name, el: c });
      }
      for (const n of c.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const lines = [];
        for (const q of rg.getClientRects()) {
          if (offBox(q)) continue;
          const last = lines[lines.length - 1], y = q.top - R.top;
          if (last && Math.abs(last.y - y) < 2) last.x2 = Math.max(last.x2, q.right - R.left); else lines.push({ x: q.left - R.left, x2: q.right - R.left, y, h: q.height });
        }
        if (lines.length) parts.push({ kind: "text", lines, x: Math.min(...lines.map((l) => l.x)), y: lines[0].y, w: Math.max(...lines.map((l) => l.x2 - l.x)), h: lines.reduce((a, l) => a + l.h, 0), name: "text", el: c });
      }
      walk(c);
    }
  };
  walk(el);
  // the same box twice (a button and the span that fills it) is drawn once
  for (let i = parts.length - 1; i > 0; i--) {
    const p = parts[i]; if (p.kind !== "box") continue;
    if (parts.some((q, j) => j < i && q.kind === "box" && Math.abs(q.x - p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5 && Math.abs(q.w - p.w) < 1.5 && Math.abs(q.h - p.h) < 1.5)) parts.splice(i, 1);
  }
  // too many parts: keep the largest, in document order
  if (parts.length > opts.maxParts) {
    const keep = new Set([...parts].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, opts.maxParts));
    for (let i = parts.length - 1; i >= 0; i--) if (!keep.has(parts[i])) parts.splice(i, 1);
  }
  // key elements: interactive boxes first, then the largest boxes
  const boxes = parts.filter((p) => p.kind === "box");
  [...boxes.filter((b) => b.interactive), ...boxes.filter((b) => !b.interactive).sort((a, b) => b.w * b.h - a.w * a.h)].slice(0, opts.keys).forEach((k) => (k.key = true));
  return { w: R.width, h: R.height, r: Math.min(radius, R.width / 2, R.height / 2), parts };
}

// ─── 2. build the overlay ───
const MG = 44, DOT_GAP = 4.8, GUIDE_GAP = 6.5;
function mkStroke(d, parent, cls = "t-gen-wire", extra = {}) {
  const e = svg("path", Object.assign({ d, class: cls }, extra), parent);
  return { el: e, L: e.getTotalLength(), gap: cls === "t-gen-guide" ? GUIDE_GAP : DOT_GAP };
}
const mkHead = (parent, r = 2.4) => svg("circle", { r, class: "t-gen-head", opacity: 0 }, parent);

// Everything but the parts: dot field, guides, outline, particles, reticle, handles, scan line.
// T places the outline (and the particles that land on it) and the card handles on the run's clock.
function buildFrame(el, w, h, radius, opts, T) {
  // (local change 5) at most ~opts.maxDots dots in the field
  const SP = Math.max(15, Math.ceil(Math.sqrt(((w + 2 * MG) * (h + 2 * MG)) / (opts.maxDots || MAX_DOTS))));
  const layer = document.createElement("div");
  layer.className = "t-gen";
  layer.setAttribute("aria-hidden", "true"); // decoration only: assistive tech reads the real element
  Object.assign(layer.style, { left: "0px", top: "0px", width: f2(w) + "px", height: f2(h) + "px" });
  const root = svg("svg", { class: "t-gen-svg", width: f2(w), height: f2(h), viewBox: `0 0 ${f2(w)} ${f2(h)}` }, layer);
  opts.mount.appendChild(layer); // in the page first: SVG geometry can only be measured once it renders
  const G = { el, layer, root, w, h, M: MG, chrome: opts.chrome !== false, u: 1 / (opts.scale || 1), dimTo: opts.dim, hidden: !!opts.hidden, n: (buildFrame.n = (buildFrame.n || 0) + 1), parts: [], keys: [] };
  const defs = svg("defs", {}, root);

  // dot field + matrix rain columns
  const dots = svg("g", {}, root); G.dots = []; let maxD = 0;
  for (let x = -Math.floor(MG / SP) * SP; x <= w + MG; x += SP) for (let y = -Math.floor(MG / SP) * SP; y <= h + MG; y += SP) {
    const d = Math.hypot(x - w / 2, y - h / 2), out = Math.max(0, -x, x - w, -y, y - h), col = Math.round(x / SP);
    G.dots.push({ el: svg("circle", { cx: x, cy: y, r: 1.1, class: "t-gen-dot" }, dots), x, y, d, edge: 1 - clamp(out / MG), inside: out === 0,
      v: 0.07 + 0.09 * hashN(col * 7.13 + G.n * 31.7), ph: hashN(col * 3.71 + G.n * 11.3) * 900, tr: 50 + 70 * hashN(col * 1.91 + G.n) });
    maxD = Math.max(maxD, d);
  }
  G.maxD = maxD; G.span = h + 2 * MG;

  // probe, guides, size label
  G.probe = svg("path", { d: `M0 ${-MG}V${f2(h + MG)}`, class: "t-gen-guide t-gen-guide--dashed", opacity: 0 }, root);
  G.guides = [[-MG, 0, w + MG, 0], [w, -MG, w, h + MG], [w + MG, h, -MG, h], [0, h + MG, 0, -MG]].map(([a, b, c, d]) => mkStroke(`M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`, root, "t-gen-guide", { style: "opacity:0" }));
  G.dim = svg("text", { x: 0, y: f2(h + 18), class: "t-gen-label" }, root); // (local change 7) under the element: the canvas draws the frame name above it

  // wireframe: wiped away behind the scan line
  const clip = svg("clipPath", { id: "t-gen-clip-" + G.n }, defs);
  G.clipRect = svg("rect", { x: -MG - 10, y: -MG, width: w + 2 * MG + 20, height: h + 2 * MG }, clip);
  const glow = svg("linearGradient", { id: "t-gen-glow-" + G.n, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svg("stop", { offset: 0, class: "t-gen-glow-stop", "stop-opacity": 0 }, glow); svg("stop", { offset: 1, class: "t-gen-glow-stop", "stop-opacity": 0.12 }, glow);
  const wire = svg("g", { "clip-path": `url(#t-gen-clip-${G.n})`, class: "t-gen-wireframe" }, root); G.wire = wire;
  G.outline = [1, 0].map((dir) => Object.assign(mkStroke(rrHalf(0, 0, w, h, radius, dir), wire), { head: mkHead(wire, 2.8) }));
  G.keyLayer = svg("g", {}, root); // key elements' guides, handles and labels, added with their parts

  // particles that land on the outline as it is drawn there
  const inv = (f) => { let lo = 0, hi = 1; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (OUT(m) < f) lo = m; else hi = m; } return lo; };
  G.flyers = [];
  for (let i = 0; i < 44; i++) {
    const half = G.outline[i % 2], f = 0.06 + 0.9 * (Math.floor(i / 2) / 21), pt = half.el.getPointAtLength(half.L * f);
    const ang = hashN(i * 9.1 + G.n) * Math.PI * 2, dist = 30 + 70 * hashN(i * 4.7 + G.n * 2), arr = T.outline[0] + (T.outline[1] - T.outline[0]) * inv(f);
    G.flyers.push({ el: svg("circle", { r: 1.6, class: "t-gen-flyer", opacity: 0 }, root), x0: pt.x + Math.cos(ang) * dist, y0: pt.y + Math.sin(ang) * dist, x1: pt.x, y1: pt.y, arr, s0: arr - T.lead });
  }

  // reticle, card handles, coordinate readout, scan line
  G.ret = svg("path", { class: "t-gen-reticle", opacity: 0 }, root); G.tag = svg("text", { class: "t-gen-label t-gen-label--tag", opacity: 0 }, root);
  G.handles = [[0, 0, T.handles[0]], [w, 0, T.handles[0]], [w, h, T.handles[1]], [0, h, T.handles[1]]].map(([x, y, at]) => ({ el: svg("rect", { x: -2.5, y: -2.5, width: 5, height: 5, class: "t-gen-handle", transform: `translate(${f2(x)} ${f2(y)}) scale(0)` }, root), x, y, at }));
  G.read = svg("text", { class: "t-gen-label t-gen-label--small", opacity: 0 }, root);
  G.scan = svg("g", { opacity: 0 }, root);
  svg("rect", { x: 0, y: -28, width: w, height: 28, fill: `url(#t-gen-glow-${G.n})` }, G.scan);
  G.scanLine = svg("path", { d: `M-18 0H${f2(w + 18)}`, class: "t-gen-guide t-gen-guide--scan" }, G.scan);
  svg("circle", { cx: 0, cy: 0, r: 2.3, class: "t-gen-head" }, G.scan); svg("circle", { cx: w, cy: 0, r: 2.3, class: "t-gen-head" }, G.scan);
  return G;
}

// One part (box, text block or icon) as wireframe strokes. Null when it has nothing to draw.
function addPart(G, P) {
  const wire = G.wire, strokes = [];
  if (P.kind === "box" && P.key) [1, 0].forEach((dir) => strokes.push(Object.assign(mkStroke(rrHalf(P.x, P.y, P.w, P.h, P.r, dir), wire), { together: true })));
  else if (P.kind === "box") strokes.push(mkStroke(rrPath(P.x, P.y, P.w, P.h, P.r), wire));
  if (P.kind === "text") for (const ln of P.lines) strokes.push(textStroke(ln, wire));
  if (P.kind === "icon") for (const src of P.paths) {
    const [a, b, c, d] = src.m, k = Math.sqrt(Math.abs(a * d - b * c)) || 1;
    const g = svg("g", { transform: `matrix(${src.m.map((v) => (+v).toFixed(3)).join(" ")})`, style: `stroke-width:${(1.8 / k).toFixed(3)}` }, wire);
    const e = svg(src.tag, Object.assign({}, src.attrs, { class: "t-gen-wire" }), g);
    strokes.push({ el: e, L: e.getTotalLength ? e.getTotalLength() : 0, gap: 3.6, k, local: g });
  }
  if (!strokes.length) return null;
  // hidden until a frame draws them: a part added between two frames must not paint as a solid line
  strokes.forEach((s) => { s.el.style.opacity = 0; s.head = mkHead(s.local || wire, 2.4 / (s.k || 1)); });
  let ix = -1; strokes.forEach((s, i) => (s.idx = s.together && i > 0 && strokes[i - 1].together ? ix : ++ix)); strokes.n = ix + 1;
  const pt = { strokes, kind: P.kind, b: { x: P.x, y: P.y, w: P.w, h: P.h }, name: P.name, key: !!P.key };
  if (pt.key) pt.K = addKey(G, pt);
  return pt;
}
function textY(ln) { return ln.y + ln.h * 0.56; }
function textStroke(ln, parent) {
  const y = textY(ln), s = mkStroke(`M${f2(ln.x)} ${f2(y)}H${f2(ln.x2)}`, parent);
  s.caps = [svg("circle", { cx: f2(ln.x), cy: f2(y), r: 1.7, class: "t-gen-head", opacity: 0 }, parent), svg("circle", { cx: f2(ln.x2), cy: f2(y), r: 1.7, class: "t-gen-head", opacity: 0 }, parent)];
  return s;
}
// key elements: their own guides, corner handles and size label
function addKey(G, pt) {
  const { x, y, w: bw, h: bh } = pt.b, E = 16, root = G.keyLayer;
  return { pt,
    guides: [[x - E, y, x + bw + E, y], [x + bw, y - E, x + bw, y + bh + E], [x + bw + E, y + bh, x - E, y + bh], [x, y + bh + E, x, y - E]].map(([a, b, c, d]) => mkStroke(`M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`, root, "t-gen-guide", { opacity: 0 })),
    handles: [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]].map(([hx, hy]) => ({ el: svg("rect", { x: -2, y: -2, width: 4, height: 4, class: "t-gen-handle", transform: `translate(${f2(hx)} ${f2(hy)}) scale(0)` }, root), x: hx, y: hy })),
    dim: svg("text", { x: f2(x), y: f2(y - 5), class: "t-gen-label t-gen-label--small", opacity: 0 }, root) };
}
function removePart(pt) {
  for (const s of pt.strokes) { (s.local || s.el).remove(); if (!s.local && s.head) s.head.remove(); if (s.caps) s.caps.forEach((c) => c.remove()); }
  if (pt.K) { pt.K.guides.forEach((g) => g.el.remove()); pt.K.handles.forEach((hd) => hd.el.remove()); pt.K.dim.remove(); }
}

function buildOverlay(el, M, opts) {
  const G = buildFrame(el, M.w, M.h, M.r, opts, { outline: PH.outline, lead: 0.09, handles: [0.17, 0.37] });
  for (const P of M.parts) { const pt = addPart(G, P); if (pt) G.parts.push(pt); }
  const N = G.parts.length, span = PH.parts[1] - PH.parts[0], dur = Math.min(0.2, span * 0.6);
  G.parts.forEach((pt, i) => { pt.t0 = PH.parts[0] + (N > 1 ? (span - dur) * (i / (N - 1)) : 0); pt.t1 = pt.t0 + dur; });
  G.keys = G.parts.filter((pt) => pt.K).map((pt) => pt.K);
  return G;
}

// ─── 3. one frame of the build: p = progress (0 → END), t = ms since start ───
const FLOW = 0.016;
function drawStroke(s, q, t) {
  const on = q > 0; s.el.style.opacity = on ? 1 : 0;
  if (on) {
    const gap = s.gap / (s.k || 1), n = Math.floor((s.L * Math.min(1, q)) / gap) + 1;
    if (n !== s.n) { s.n = n; s.el.style.strokeDasharray = `${`0 ${f2(gap)} `.repeat(n - 1)}0 ${f2(s.L + 10)}`; }
    s.el.style.strokeDashoffset = f2(-((t * FLOW) / (s.k || 1)) % gap);
  }
  if (s.head) {
    const live = (s.live = q > 0 && q < 1); s.head.setAttribute("opacity", live ? 1 : 0);
    if (live) { const gap = s.gap / (s.k || 1); s.pt = s.el.getPointAtLength(Math.floor((s.L * q) / gap) * gap); s.head.setAttribute("cx", f2(s.pt.x)); s.head.setAttribute("cy", f2(s.pt.y)); }
  }
  if (s.caps) { s.caps[0].setAttribute("opacity", on ? 1 : 0); s.caps[1].setAttribute("opacity", q >= 1 ? 1 : 0); }
}

// (local change 3) the element stays in view: a mask dims it, and the scan line lifts the dim from the top down
function setMask(es, value) { es.maskImage = value; es.webkitMaskImage = value; }
const HIDE_MASK = "linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0))";
function maskElement(G, p, y) {
  const es = G.el.style, D = G.dimTo, a = (v) => `rgba(0,0,0,${f2(v)})`;
  if (p >= PH.reveal[1]) { es.maskImage = G.prev.maskImage; es.webkitMaskImage = G.prev.webkitMaskImage; return; }
  if (p < PH.reveal[0]) { const k = G.hidden ? 0 : lerp(1, D, smooth(0, 0.1, p)); setMask(es, `linear-gradient(${a(k)},${a(k)})`); return; }
  // mask-image runs in the element's own (unscaled) box: convert the scan position from screen px
  const yl = y * G.u, soft = 28 * G.u;
  setMask(es, `linear-gradient(to bottom,#000 ${f2(yl)}px,${a(G.hidden ? 0 : D)} ${f2(yl + soft)}px)`);
}

function frame(G, p, t, D) {
  const { w, h } = G, clean = 1 - smooth(PH.clean[0], PH.clean[1], p), u = G.u;
  const sq = SMOOTH_OUT(win(PH.reveal, p)), y = sq * (h + 6) - 3, fq = SMOOTH_OUT(win([PH.reveal[0], PH.reveal[1] + 0.03], p));
  maskElement(G, p, y);
  G.clipRect.setAttribute("y", f2(p < PH.reveal[0] ? -999 : y)); G.clipRect.setAttribute("height", f2(h + 999));
  G.wire.setAttribute("opacity", f2(1 - 0.6 * fq));
  G.scan.setAttribute("opacity", f2(p >= PH.reveal[0] && p < PH.reveal[1] ? smooth(0, 0.12, sq) * (1 - smooth(0.85, 1, sq)) : 0));
  G.scan.setAttribute("transform", `translate(0 ${f2(y)})`);
  G.scanLine.style.strokeDashoffset = f2(-(t * FLOW * 2) % 5);

  // dot field: ripple from the centre, matrix rain down the columns, lit by the probe and the reticle
  const R = OUT(win(PH.dots, p)) * (G.maxD + 60), rainOn = smooth(0.04, 0.2, p) * (1 - smooth(0.62, 0.86, p));
  const pw = win(PH.probe, p), probeX = lerp(-G.M, w + G.M, OUT(pw)), probeOp = pw > 0 && pw < 1 ? smooth(0, 0.1, pw) * (1 - smooth(0.85, 1, pw)) : 0;
  G.probe.setAttribute("transform", `translate(${f2(probeX)} 0)`); G.probe.setAttribute("opacity", f2(probeOp * 0.8));
  let rb = null, rOp = 0;
  const at = G.parts.reduce((k, pt, i) => (p >= pt.t0 ? i : k), -1);
  if (at >= 0 && p < PH.reveal[0] + 0.06) {
    const pt = G.parts[at], from = at ? G.parts[at - 1].b : { x: 0, y: 0, w, h }, q = OUT(clamp((p - pt.t0) / 0.05)), P = 5;
    rb = { x: lerp(from.x, pt.b.x, q) - P, y: lerp(from.y, pt.b.y, q) - P, w: lerp(from.w, pt.b.w, q) + 2 * P, h: lerp(from.h, pt.b.h, q) + 2 * P };
    rOp = smooth(PH.parts[0], PH.parts[0] + 0.04, p) * (1 - smooth(PH.reveal[0], PH.reveal[0] + 0.06, p));
    const l = Math.min(7, rb.w / 3, rb.h / 3), { x: X, y: Y, w: RW, h: RH } = rb;
    G.ret.setAttribute("d", `M${f2(X)} ${f2(Y + l)}V${f2(Y)}H${f2(X + l)}M${f2(X + RW - l)} ${f2(Y)}H${f2(X + RW)}V${f2(Y + l)}M${f2(X + RW)} ${f2(Y + RH - l)}V${f2(Y + RH)}H${f2(X + RW - l)}M${f2(X + l)} ${f2(Y + RH)}H${f2(X)}V${f2(Y + RH - l)}`);
    G.tag.setAttribute("x", f2(X)); G.tag.setAttribute("y", f2(Y - 4)); G.tag.textContent = `${pt.name} ${Math.round(pt.b.w * u)}×${Math.round(pt.b.h * u)}`;
  }
  G.ret.setAttribute("opacity", f2(rOp)); G.tag.setAttribute("opacity", f2(rOp));
  for (const d of G.dots) {
    const lag = R - d.d, env = clamp(lag / 50), front = p < PH.dots[1] + 0.05 ? Math.exp(-(((lag - 6) / 14) ** 2)) : 0;
    const headY = ((t * d.v + d.ph) % (G.span + d.tr)) - G.M, back = headY - d.y;
    const rain = back >= 0 && back < d.tr ? (1 - back / d.tr) ** 1.6 * rainOn * env * d.edge : 0;
    const near = rb ? Math.max(0, 1 - Math.max(rb.x - d.x, d.x - rb.x - rb.w, rb.y - d.y, d.y - rb.y - rb.h, 0) / 16) * (d.x > rb.x && d.x < rb.x + rb.w && d.y > rb.y && d.y < rb.y + rb.h ? 1 : 0.6) : 0;
    const probe = probeOp > 0 ? Math.exp(-(((d.x - probeX) / 9) ** 2)) * probeOp * env : 0;
    const lit = Math.max(front, rain, near * rOp * 0.8, probe), under = d.inside && p >= PH.reveal[0] && d.y < y ? 0 : 1; // gone where the real UI is in
    d.el.setAttribute("opacity", f2(Math.max(env * 0.5 * d.edge, lit * d.edge) * clean * under));
    d.el.setAttribute("r", f2(1.05 + lit * 0.85));
    d.el.classList.toggle("is-lit", lit > 0.35);
  }

  // guides, size label, outline, card handles, particles
  const gOp = 0.5 * (1 - smooth(0.66, 0.92, p));
  if (G.chrome) G.guides.forEach((g, i) => { const q = OUT(clamp((p - PH.guides[0] - i * 0.03) / (PH.guides[1] - PH.guides[0] - 0.09))); drawStroke(g, q, t); g.el.style.opacity = q > 0 ? gOp : 0; });
  const oq = OUT(win(PH.outline, p));
  G.dim.textContent = `${Math.round(w * u * oq)} × ${Math.round(h * u * oq)}   t+${(Math.min(p, 1) * D / 1000).toFixed(2)}s`;
  G.dim.setAttribute("opacity", f2(p > PH.outline[0] ? (1 - smooth(0.66, 0.9, p)) * 0.9 : 0));
  G.outline.forEach((s) => drawStroke(s, oq, t));
  if (G.chrome) G.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(OUT(clamp((p - hd.at) / 0.1)) * (1 - smooth(0.82, 0.96, p)))})`));
  for (const q of G.flyers) {
    const k = clamp((p - q.s0) / (q.arr - q.s0)), on = p >= q.s0 && p < q.arr + 0.01;
    q.el.setAttribute("opacity", on ? f2(smooth(0, 0.25, k)) : 0);
    if (on) { const e = OUT(k); q.el.setAttribute("cx", f2(lerp(q.x0, q.x1, e))); q.el.setAttribute("cy", f2(lerp(q.y0, q.y1, e))); }
  }
  // every part traced in order, icons stroke by stroke; key elements get guides, handles and a size label
  for (const pt of G.parts) { const q = clamp((p - pt.t0) / (pt.t1 - pt.t0)); pt.strokes.forEach((s) => drawStroke(s, OUT(clamp(q * pt.strokes.n - s.idx * 0.75)), t)); }
  const kOut = 1 - smooth(PH.reveal[0] - 0.02, PH.reveal[0] + 0.1, p);
  for (const K of G.keys) {
    const t0 = K.pt.t0 - 0.03, hq = OUT(clamp((p - K.pt.t0 - 0.04) / 0.08)), oq2 = OUT(clamp((p - K.pt.t0) / (K.pt.t1 - K.pt.t0)));
    K.guides.forEach((g, i) => { const q = OUT(clamp((p - t0 - i * 0.012) / 0.1)); drawStroke(g, q, t); g.el.style.opacity = q > 0 ? f2(0.5 * kOut) : 0; });
    K.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(hq * kOut)})`));
    K.dim.setAttribute("opacity", f2(p > t0 ? 0.9 * kOut : 0)); K.dim.textContent = `${Math.round(K.pt.b.w * u * oq2)} × ${Math.round(K.pt.b.h * u * oq2)}`;
  }
  // coordinate readout on the line being drawn
  let cur = null; for (const s of [...G.outline, ...G.parts.flatMap((pt) => pt.strokes)]) if (s.live && !s.local) cur = s;
  G.read.setAttribute("opacity", cur ? 1 : 0);
  if (cur) { G.read.setAttribute("x", f2(cur.pt.x + 6)); G.read.setAttribute("y", f2(cur.pt.y - 5)); G.read.textContent = `${String(Math.round(cur.pt.x * u)).padStart(3, "0")}·${String(Math.round(cur.pt.y * u)).padStart(3, "0")}`; }
}

// ─── 4. run ───
export function generate(el, options = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  if (!el) throw new Error("UIGeneration: no element");
  if (!opts.mount) throw new Error("UIGeneration: no mount");
  if (el.__tGen) el.__tGen.cancel();
  const prev = { maskImage: el.style.maskImage, webkitMaskImage: el.style.webkitMaskImage };
  let resolve, raf = 0, timer = 0, G = null, stopped = false;
  const finished = new Promise((r) => (resolve = r));
  const finish = () => {
    if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer);
    if (G) G.layer.remove();
    el.style.maskImage = prev.maskImage; el.style.webkitMaskImage = prev.webkitMaskImage;
    el.__tGen = null; if (opts.onDone) opts.onDone(el); resolve(el);
  };
  const run = { finished, cancel: finish, element: el };
  el.__tGen = run;
  // (local change 8) hide at once, not on the first frame: the element must never flash in first
  if (opts.hidden && !reduced()) setMask(el.style, HIDE_MASK);

  // (local change 6) reduced motion: the element is already in view, so nothing is drawn
  if (reduced()) { finish(); return run; }
  timer = setTimeout(() => {
    raf = requestAnimationFrame(() => {
      if (stopped) return;
      try { const M = measure(el, opts); G = buildOverlay(el, M, opts); G.prev = prev; }
      catch (e) { for (const n of opts.mount.querySelectorAll(":scope > .t-gen")) n.remove(); G = null; console.warn("UIGeneration: could not build the overlay", e); return finish(); }
      const D = Math.max(400, +opts.duration || DEFAULTS.duration), t0 = performance.now();
      frame(G, 0, 0, D); // the first state now: the overlay is already in the page
      const tick = (now) => {
        if (stopped) return;
        const t = now - t0, p = t / D;
        frame(G, p, t, D);
        if (p >= END) return finish();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  }, opts.delay);
  return run;
}

// ─── 5. live run (local change 9): the drawing grows with an element that is still being written ───
// Clock in ms. The intro (dot ripple, guides, outline) plays once; after it each new part is traced in
// document order as it appears. `complete()` hides the finished element, traces what the stream did
// not reach, and runs the scan line, which reveals the element from the top down.
const LIVE = {
  intro: 1200,     // ripple, guides, outline, card handles
  part: 520,       // tracing one part
  stagger: 70,     // between two parts
  rush: 18,        // between two parts when the queue is behind
  backlog: 1200,   // queue length (ms) that switches to `rush`
  keyHold: 900,    // a key element's guides stay this long after it is traced
  idle: 1300,      // the reticle fades when nothing new was traced this long
  settle: 360,     // complete(): least time before the scan line starts
  wait: 900,       // complete(): most time spent finishing the queue first
  reveal: 1000,    // scan line
  fade: 420,       // the overlay fades out after the scan line
  dots: 1400,      // dot budget: this field runs for minutes, not seconds
};

const NEVER = 1e12; // "not scheduled" on the run clock: finite, so smooth() never sees Infinity - Infinity
function scalePart(P, k) {
  P.x *= k; P.y *= k; P.w *= k; P.h *= k;
  if (P.r) P.r *= k;
  if (P.lines) for (const ln of P.lines) { ln.x *= k; ln.x2 *= k; ln.y *= k; ln.h *= k; }
  if (P.paths) for (const src of P.paths) src.m = src.m.map((v) => v * k);
}
const near = (a, b, d = 1.5) => Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d && Math.abs(a.w - b.w) < d && Math.abs(a.h - b.h) < d;
function sameShape(pt, P) {
  if (!near(pt.b, P)) return false;
  if (P.kind !== "text") return true;
  const a = pt.P.lines, b = P.lines;
  return a.length === b.length && a.every((l, i) => Math.abs(l.x - b[i].x) < 1.5 && Math.abs(l.x2 - b[i].x2) < 1.5 && Math.abs(l.y - b[i].y) < 1.5);
}
function setD(s, d) { s.el.setAttribute("d", d); s.L = s.el.getTotalLength(); s.n = -1; }
const setAttr = (d, k, v) => { if (d[k] !== v) { d[k] = v; d.el.setAttribute(k === "o" ? "opacity" : "r", v); } };

export function generateLive(el, options = {}) {
  // No key elements: their guides and corner handles read as the editor's own selection and resize handles.
  const opts = Object.assign({}, DEFAULTS, { maxParts: 160, maxDots: LIVE.dots }, options, { keys: 0, chrome: false });
  if (!el) throw new Error("UIGeneration: no element");
  if (!opts.mount) throw new Error("UIGeneration: no mount");
  const S = opts.scale || 1; // overlay units: screen px at this zoom
  let G = null, raf = 0, stopped = false, paused = false, t0 = 0, resolve, lastScale = S;
  let target = null, prevMask = null, tc = NEVER, completeAt = null, next = 0, keyCount = 0, frameNo = 0;
  const parts = [], byEl = new Map();
  const finished = new Promise((r) => (resolve = r));
  const clock = () => performance.now() - t0;

  const finish = () => {
    if (stopped) return; stopped = true; cancelAnimationFrame(raf);
    if (G) G.layer.remove();
    if (target) { target.style.maskImage = prevMask.maskImage; target.style.webkitMaskImage = prevMask.webkitMaskImage; }
    resolve(target);
  };
  // The zoom the element is really drawn at, read from its own box: the caller's `scale` is only a
  // fallback, since a transform can be missing for a moment while the caller rebuilds its style.
  const measured = (src, scale) => {
    const M = measure(src, { maxParts: Infinity, keys: 0 }), real = src.offsetWidth ? M.w / src.offsetWidth : scale, k = S / (real || scale);
    for (const P of M.parts) scalePart(P, k); M.w *= k; M.h *= k; M.r *= k; return M;
  };
  const schedule = (pt, t, rush) => {
    const gap = rush || next - t > LIVE.backlog ? LIVE.rush : LIVE.stagger;
    pt.from = parts.length ? parts[parts.length - 1].b : { x: 0, y: 0, w: G.w, h: G.h };
    pt.t0 = Math.max(t, next, LIVE.intro * 0.35); next = pt.t0 + gap; pt.t1 = pt.t0 + (rush ? 300 : LIVE.part);
  };
  const add = (P, t, rush) => {
    if (parts.length >= opts.maxParts) return null;
    if (P.kind === "box" && P.interactive && keyCount < opts.keys) { P.key = true; keyCount++; }
    const pt = addPart(G, P); if (!pt) return null;
    pt.P = P; schedule(pt, t, rush); parts.push(pt); return pt;
  };
  // a part whose element moved or grew: boxes and text lines reshape in place, the rest is redrawn
  const reshape = (pt, P, t) => {
    if (P.kind === "box") {
      const ds = pt.key ? [rrHalf(P.x, P.y, P.w, P.h, P.r, 1), rrHalf(P.x, P.y, P.w, P.h, P.r, 0)] : [rrPath(P.x, P.y, P.w, P.h, P.r)];
      pt.strokes.forEach((s, i) => setD(s, ds[i]));
    } else if (P.kind === "text" && P.lines.length === pt.P.lines.length) {
      pt.strokes.forEach((s, i) => { const ln = P.lines[i], y = f2(textY(ln)); setD(s, `M${f2(ln.x)} ${y}H${f2(ln.x2)}`); s.caps[0].setAttribute("cx", f2(ln.x)); s.caps[1].setAttribute("cx", f2(ln.x2)); s.caps.forEach((c) => c.setAttribute("cy", y)); });
    } else {
      P.key = pt.key; removePart(pt);
      const fresh = addPart(G, P); if (!fresh) return false;
      const started = t >= pt.t0;
      Object.assign(pt, fresh, started ? { t0: t, t1: t + 260 } : {});
    }
    pt.b = { x: P.x, y: P.y, w: P.w, h: P.h }; pt.P = P; pt.drawn = undefined; return true;
  };

  const update = (scale = lastScale, src = el) => {
    if (stopped) return;
    el = src; lastScale = scale;
    if (!G || target) return; // before the first frame the build reads it; after complete() the stream is over
    let M; try { M = measured(el, scale); } catch (e) { console.warn("UIGeneration: could not read the element", e); return; }
    const t = clock(), seen = new Set();
    for (const P of M.parts) {
      if (!P.el) continue;
      let rec = byEl.get(P.el); const old = rec && rec.get(P.kind);
      if (old) { if (sameShape(old, P) || reshape(old, P, t)) seen.add(old); continue; }
      const pt = add(P, t, false); if (!pt) continue;
      if (!rec) byEl.set(P.el, (rec = new Map()));
      rec.set(P.kind, pt); pt.owner = P.el; seen.add(pt);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const pt = parts[i]; if (seen.has(pt)) continue;
      removePart(pt); parts.splice(i, 1); if (pt.key) keyCount--;
      const rec = byEl.get(pt.owner); if (rec) { rec.delete(pt.kind); if (!rec.size) byEl.delete(pt.owner); }
    }
  };

  const startScan = () => {
    const t = clock();
    let M = { parts: [] }; try { M = measured(target, lastScale); } catch (e) { console.warn("UIGeneration: could not read the element", e); }
    // the end of the stream that the last update did not see: matched by place, not by element
    for (const P of M.parts) if (!parts.some((pt) => pt.kind === P.kind && near(pt.b, P, 2))) add(P, t, true);
    tc = Math.max(t + LIVE.settle, Math.min(next + 200, t + LIVE.wait), LIVE.intro * 0.85);
  };
  const complete = (finalEl, scale = lastScale) => {
    if (stopped) return finished;
    if (reduced()) { finish(); return finished; }
    target = finalEl; lastScale = scale;
    prevMask = { maskImage: target.style.maskImage, webkitMaskImage: target.style.webkitMaskImage };
    setMask(target.style, HIDE_MASK); // at once: the finished screen must not show before the scan line
    if (G) startScan(); else completeAt = true;
    return finished;
  };

  const frameLive = (t) => {
    const { w, h } = G, u = G.u, pi = t / LIVE.intro, revealing = t >= tc;
    const sq = revealing ? SMOOTH_OUT(clamp((t - tc) / LIVE.reveal)) : 0, y = sq * (h + 6) - 3;
    const clean = 1 - smooth(tc + LIVE.reveal * 0.55, tc + LIVE.reveal + LIVE.fade, t);
    if (target) {
      const es = target.style;
      if (!revealing) setMask(es, HIDE_MASK);
      else if (sq < 1) setMask(es, `linear-gradient(to bottom,#000 ${f2(y * u)}px,rgba(0,0,0,0) ${f2((y + 28) * u)}px)`);
      else { es.maskImage = prevMask.maskImage; es.webkitMaskImage = prevMask.webkitMaskImage; }
    }
    G.clipRect.setAttribute("y", f2(revealing ? y : -999)); G.clipRect.setAttribute("height", f2(h + 999));
    G.wire.setAttribute("opacity", f2((1 - 0.6 * sq) * clean));
    G.scan.setAttribute("opacity", f2(revealing && sq < 1 ? smooth(0, 0.12, sq) * (1 - smooth(0.85, 1, sq)) : 0));
    G.scan.setAttribute("transform", `translate(0 ${f2(y)})`);
    G.scanLine.style.strokeDashoffset = f2(-(t * FLOW * 2) % 5);

    // reticle on the part being traced; it rests when the stream goes quiet
    let cur = null; for (const pt of parts) if (t >= pt.t0 && (!cur || pt.t0 >= cur.t0)) cur = pt;
    let rb = null, rOp = 0;
    if (cur) {
      const q = OUT(clamp((t - cur.t0) / 180)), P = 5, from = cur.from || cur.b;
      rb = { x: lerp(from.x, cur.b.x, q) - P, y: lerp(from.y, cur.b.y, q) - P, w: lerp(from.w, cur.b.w, q) + 2 * P, h: lerp(from.h, cur.b.h, q) + 2 * P };
      rOp = (1 - smooth(cur.t1 + LIVE.idle, cur.t1 + LIVE.idle + 400, t)) * (1 - smooth(tc - 100, tc + 200, t));
      const l = Math.min(7, rb.w / 3, rb.h / 3), { x: X, y: Y, w: RW, h: RH } = rb;
      G.ret.setAttribute("d", `M${f2(X)} ${f2(Y + l)}V${f2(Y)}H${f2(X + l)}M${f2(X + RW - l)} ${f2(Y)}H${f2(X + RW)}V${f2(Y + l)}M${f2(X + RW)} ${f2(Y + RH - l)}V${f2(Y + RH)}H${f2(X + RW - l)}M${f2(X + l)} ${f2(Y + RH)}H${f2(X)}V${f2(Y + RH - l)}`);
      G.tag.setAttribute("x", f2(X)); G.tag.setAttribute("y", f2(Y - 4)); G.tag.textContent = `${cur.name} ${Math.round(cur.b.w * u)}×${Math.round(cur.b.h * u)}`;
    }
    G.ret.setAttribute("opacity", f2(rOp)); G.tag.setAttribute("opacity", f2(rOp));

    // dot field: every other frame while it only rains, every frame under the scan line
    const pw = clamp((pi - 0.02) / 0.6), probeX = lerp(-G.M, w + G.M, OUT(pw)), probeOp = pw > 0 && pw < 1 ? smooth(0, 0.1, pw) * (1 - smooth(0.85, 1, pw)) : 0;
    G.probe.setAttribute("transform", `translate(${f2(probeX)} 0)`); G.probe.setAttribute("opacity", f2(probeOp * 0.8));
    if (revealing || pi < 1 || frameNo++ % 2 === 0) {
      const R = OUT(clamp(pi / 0.55)) * (G.maxD + 60), rainOn = smooth(0.15, 0.5, pi) * clean;
      for (const d of G.dots) {
        const lag = R - d.d, env = clamp(lag / 50), front = pi < 0.75 ? Math.exp(-(((lag - 6) / 14) ** 2)) : 0;
        const headY = ((t * d.v + d.ph) % (G.span + d.tr)) - G.M, back = headY - d.y;
        const rain = back >= 0 && back < d.tr ? (1 - back / d.tr) ** 1.6 * rainOn * env * d.edge : 0;
        const nr = rb ? Math.max(0, 1 - Math.max(rb.x - d.x, d.x - rb.x - rb.w, rb.y - d.y, d.y - rb.y - rb.h, 0) / 16) * (d.x > rb.x && d.x < rb.x + rb.w && d.y > rb.y && d.y < rb.y + rb.h ? 1 : 0.6) : 0;
        const probe = probeOp > 0 ? Math.exp(-(((d.x - probeX) / 9) ** 2)) * probeOp * env : 0;
        const lit = Math.max(front, rain, nr * rOp * 0.8, probe), under = d.inside && revealing && d.y < y ? 0 : 1;
        setAttr(d, "o", f2(Math.max(env * 0.5 * d.edge, lit * d.edge) * clean * under));
        setAttr(d, "r", f2(1.05 + lit * 0.85));
        const on = lit > 0.35; if (on !== d.on) { d.on = on; d.el.classList.toggle("is-lit", on); }
      }
    }

    // size label with the elapsed time, outline, particles. The edge guides and card handles stay
    // hidden: on a canvas they read as the layer's selection outline and resize handles.
    const oq = OUT(clamp((pi - 0.15) / 0.6));
    G.dim.textContent = `${Math.round(w * u * oq)} × ${Math.round(h * u * oq)}   t+${(Math.min(t, tc) / 1000).toFixed(1)}s`;
    G.dim.setAttribute("opacity", f2(pi > 0.15 ? 0.9 * (1 - smooth(tc, tc + 300, t)) : 0));
    G.outline.forEach((s) => drawStroke(s, oq, t));
    if (pi < 1.2) for (const q of G.flyers) {
      const k = clamp((pi - q.s0) / (q.arr - q.s0)), on = pi >= q.s0 && pi < q.arr + 0.01;
      q.el.setAttribute("opacity", on ? f2(smooth(0, 0.25, k)) : 0);
      if (on) { const e = OUT(k); q.el.setAttribute("cx", f2(lerp(q.x0, q.x1, e))); q.el.setAttribute("cy", f2(lerp(q.y0, q.y1, e))); }
    }

    // parts, stroke by stroke; key elements show guides, handles and a size label for a while
    for (const pt of parts) {
      if (t < pt.t0 && pt.drawn === 0) continue;
      const q = clamp((t - pt.t0) / (pt.t1 - pt.t0)); if (q >= 1 && pt.drawn === 1 && !revealing) continue;
      pt.strokes.forEach((s) => drawStroke(s, OUT(clamp(q * pt.strokes.n - s.idx * 0.75)), t)); pt.drawn = q;
      if (!pt.K) continue;
      const K = pt.K, kOut = (1 - smooth(pt.t1 + LIVE.keyHold, pt.t1 + LIVE.keyHold + 300, t)) * (1 - smooth(tc - 100, tc + 200, t));
      const hq = OUT(clamp((t - pt.t0 - 80) / 160)), oq2 = OUT(q);
      K.guides.forEach((g, i) => { const gq = OUT(clamp((t - pt.t0 + 60 - i * 25) / 200)); drawStroke(g, gq, t); g.el.style.opacity = gq > 0 ? f2(0.5 * kOut) : 0; });
      K.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(hq * kOut)})`));
      K.dim.setAttribute("opacity", f2(t > pt.t0 - 60 ? 0.9 * kOut : 0)); K.dim.textContent = `${Math.round(pt.b.w * u * oq2)} × ${Math.round(pt.b.h * u * oq2)}`;
      if (kOut > 0) pt.drawn = -1; // keep animating until the key visuals are gone
    }
    // coordinate readout on the line being drawn
    let live = null; for (const s of [...G.outline, ...parts.flatMap((pt) => pt.strokes)]) if (s.live && !s.local) live = s;
    G.read.setAttribute("opacity", live ? 1 : 0);
    if (live) { G.read.setAttribute("x", f2(live.pt.x + 6)); G.read.setAttribute("y", f2(live.pt.y - 5)); G.read.textContent = `${String(Math.round(live.pt.x * u)).padStart(3, "0")}·${String(Math.round(live.pt.y * u)).padStart(3, "0")}`; }
  };

  const tick = () => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (paused || !opts.mount.isConnected) return;
    try {
      if (!G) {
        // handed over before the first frame: the streamed element is gone, the finished one is here
        if (target) el = target;
        const M = measured(el, lastScale);
        G = buildFrame(el, M.w, M.h, M.r, opts, { outline: [0.15, 0.75], lead: 0.12, handles: [0.3, 0.6] });
        t0 = performance.now(); update(lastScale, el);
        if (completeAt) startScan();
      }
      const t = clock(); frameLive(t);
      if (t >= tc + LIVE.reveal + LIVE.fade) finish();
    } catch (e) {
      console.warn("UIGeneration: live run failed", e); finish();
    }
  };

  const run = {
    finished, scale: S, update, complete, cancel: finish, get element() { return el; },
    // move the overlay to another mount without losing its state (the streaming box goes away, the real one takes over)
    detach() { paused = true; if (G) G.layer.remove(); },
    adopt(mount) { if (stopped) return; opts.mount = mount; if (G) mount.appendChild(G.layer); paused = false; },
  };
  if (reduced()) { finish(); return run; }
  raf = requestAnimationFrame(tick);
  return run;
}
