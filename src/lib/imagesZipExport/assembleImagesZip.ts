import { zipSync } from "fflate";

/** One rasterized frame, ready to land in the ZIP as `name` (with extension). */
export interface ZipImageFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Assemble a flat ZIP archive from independently rasterized images. Pure and
 * Pixi/DOM-free (mirrors `assemblePdfFromPngPages` / `buildPptxPackage` — see
 * CLAUDE.md's tested-pure-assembly / untested-Pixi-orchestrator split); the
 * Pixi rasterization that produces each file's bytes lives in
 * `exportImagesZipUtils.ts` and is not unit-tested.
 *
 * Duplicate `name`s (e.g. two top-level frames both named "Slide 1", common
 * after duplicating a frame) would otherwise silently collide in the
 * underlying `Record<string, Uint8Array>` and drop files from the archive.
 * This dedupes by inserting a numeric suffix before the extension
 * (`Slide 1.png`, `Slide 1-2.png`, `Slide 1-3.png`, ...), so every input file
 * is guaranteed to survive into the archive under a unique name.
 */
export function assembleImagesZip(files: ZipImageFile[]): Uint8Array {
  if (files.length === 0) {
    throw new Error("assembleImagesZip requires at least one file");
  }

  const assignedNames = new Set<string>();
  const record: Record<string, Uint8Array> = {};
  for (const { name, bytes } of files) {
    record[dedupeName(name, assignedNames)] = bytes;
  }

  // PNG/JPEG/WebP payloads are already compressed; DEFLATE (fflate's default
  // level 6) burns CPU re-scanning them for ~0 size gain. Store uncompressed.
  return zipSync(record, { level: 0 });
}

function dedupeName(name: string, assignedNames: Set<string>): string {
  if (!assignedNames.has(name)) {
    assignedNames.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);

  let suffix = 2;
  let candidate = `${base}-${suffix}${ext}`;
  while (assignedNames.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}${ext}`;
  }
  assignedNames.add(candidate);
  return candidate;
}
