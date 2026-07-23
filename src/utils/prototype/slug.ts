function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Assign each screen a filesystem-safe, unique slug derived from its name
 * (falling back to `screen-N` for blank names). Collisions get a `-2`, `-3`,
 * ... suffix. */
export function assignScreenSlugs(screens: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  screens.forEach((s, idx) => {
    const base = slugify(s.name) || `screen-${idx + 1}`;
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    out.set(s.id, slug);
  });
  return out;
}

/** Pick the top-left screen (min y, then min x) as the prototype's start
 * screen — matches how designers typically lay out a flow left-to-right,
 * top-to-bottom on the canvas. */
export function pickStartScreenId(screens: { id: string; x: number; y: number }[]): string {
  return [...screens].sort((a, b) => a.y - b.y || a.x - b.x)[0]!.id;
}
