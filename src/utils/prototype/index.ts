import { zipSync } from "fflate";
import { saveBlob } from "@/lib/downloadFile";
import type { PrototypeScreenInput, PrototypeLink } from "./types";
import { extractPrototypeCandidates } from "./extractCandidates";
import { assignScreenSlugs, pickStartScreenId } from "./slug";
import { applyPrototypeLinks } from "./applyLinks";
import { planPrototypeFiles, type PrototypeFile } from "./buildFiles";
import { fetchPrototypeLinks } from "@/lib/prototypeApi";

export interface PrototypeEmbed {
  id: string;
  name: string;
  html: string;
  x: number;
  y: number;
}

/**
 * Pure orchestration: extract clickable candidates from each embed's HTML,
 * resolve the navigation graph (via `fetchLinks`, defaulting to the real
 * backend call), apply the resolved links back into each screen's HTML, and
 * plan the final standalone `.html` files + `index.html` redirect. Kept
 * separate from `generatePrototypeZip` so it's unit-testable with an
 * injected `fetchLinks` stub (no network in tests).
 */
export async function buildPrototypeFiles(
  embeds: PrototypeEmbed[],
  fetchLinks: (screens: PrototypeScreenInput[]) => Promise<PrototypeLink[]> = fetchPrototypeLinks,
): Promise<PrototypeFile[]> {
  const extracted = embeds.map((e) => ({ ...e, ...extractPrototypeCandidates(e.html) }));
  const slugs = assignScreenSlugs(embeds);
  const startId = pickStartScreenId(embeds);

  const links = await fetchLinks(
    extracted.map((e) => ({ id: e.id, name: e.name, candidates: e.candidates })),
  );

  const screens = extracted.map((e) => {
    const forScreen = links
      .filter((l) => l.screenId === e.id)
      .map((l) => ({ protoId: l.protoId, targetSlug: slugs.get(l.targetScreenId) }))
      .filter((l): l is { protoId: string; targetSlug: string } => l.targetSlug != null);
    return {
      id: e.id,
      name: e.name,
      headHtml: e.headHtml,
      linkedHtml: applyPrototypeLinks(e.annotatedHtml, forScreen),
    };
  });

  return planPrototypeFiles(screens, startId, slugs);
}

/** Build the prototype files and package them into a downloaded
 * `prototype.zip`. Not unit-tested (DOM download side effect) — mirrors
 * `exportFramesToImagesZip`'s tested-pure-core / untested-orchestrator
 * split. Uses `fflate` (already a dep, see `assembleImagesZip.ts`) rather
 * than JSZip, which isn't installed in this project. */
export async function generatePrototypeZip(embeds: PrototypeEmbed[]): Promise<void> {
  const files = await buildPrototypeFiles(embeds);
  const encoder = new TextEncoder();
  const record: Record<string, Uint8Array> = {};
  for (const f of files) record[f.name] = encoder.encode(f.content);
  const zipBytes = zipSync(record, { level: 0 });
  const blob = new Blob([zipBytes], { type: "application/zip" });
  saveBlob(blob, "prototype.zip");
}
