/** Lowercase a-z0-9 slug of `name`; `fallback` when nothing survives. */
export function slugify(name: string, fallback = "mode", foldAccents = false): string {
  const text = foldAccents ? name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "") : name;
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}
