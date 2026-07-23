import { zipSync } from "fflate";
import { saveBlob } from "@/lib/downloadFile";
import type { PrototypeScreenInput, PrototypeLink } from "./types";
import { extractPrototypeCandidates } from "./extractCandidates";
import { assignScreenSlugs, pickStartScreenId } from "./slug";
import { applyPrototypeLinks } from "./applyLinks";
import { planPrototypeFiles, type PrototypeFile } from "./buildFiles";
import { fetchPrototypeLinks } from "@/lib/prototypeApi";
import { heuristicPrototypeLinks } from "./heuristicLinks";

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
  const slugSet = new Set(slugs.values());

  // Screens are keyed by slug (not the embed's node id) so the model reasons
  // over and returns stable slugs — both for its own screenId/targetScreenId
  // and so they line up 1:1 with the deterministic heuristic pass below.
  const screenInputs = extracted.map((e) => ({
    id: slugs.get(e.id)!,
    name: e.name,
    content: e.contentText,
    candidates: e.candidates,
  }));

  // Deterministic pass: always runs, never fails, catches the obvious cases
  // (a "Pricing" button on a screen named "Pricing") even when the model
  // returns nothing or the backend call fails outright.
  const heuristicLinks = heuristicPrototypeLinks(
    screenInputs.map((s) => ({ slug: s.id, name: s.name, candidates: s.candidates })),
  );

  let modelLinks: PrototypeLink[];
  try {
    modelLinks = await fetchLinks(screenInputs);
  } catch (err) {
    console.warn("prototype-link: fetchLinks failed, falling back to heuristic links only", err);
    modelLinks = [];
  }

  // Merge: one target per (screenId, protoId). Model links first, then
  // heuristic links overwrite on conflict — a heuristic match is a
  // high-confidence exact/near-exact name match, so it wins over the
  // model's guess. Both sides are keyed and targeted by slug already.
  const merged = new Map<string, string>();
  for (const l of modelLinks) {
    if (!slugSet.has(l.screenId) || !slugSet.has(l.targetScreenId)) continue;
    merged.set(`${l.screenId}::${l.protoId}`, l.targetScreenId);
  }
  for (const l of heuristicLinks) {
    merged.set(`${l.screenId}::${l.protoId}`, l.targetScreenId);
  }

  const screens = extracted.map((e) => {
    const slug = slugs.get(e.id)!;
    const forScreen = e.candidates
      .map((c) => ({ protoId: c.protoId, targetSlug: merged.get(`${slug}::${c.protoId}`) }))
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
