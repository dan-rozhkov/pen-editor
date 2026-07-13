import { buildPptxPackage, OPC, NS, EMPTY_SPTREE_HEADER } from "./opc";
import { shapeXml } from "./drawingml/mappers";
import type { PptxDocInput, MediaInput } from "./types";

/**
 * Assemble a .pptx from the pure IR. No Pixi/DOM — unit-testable, mirrors
 * `assemblePdfFromPngPages` (see `src/lib/pdfExport/assemblePdf.ts`).
 * Media are deduplicated by content across the whole deck.
 */
export function assemblePptx(input: PptxDocInput): Uint8Array {
  if (input.slides.length === 0) {
    throw new Error("assemblePptx requires at least one slide");
  }

  // Content-addressed media registry: identical bytes → one ppt/media file.
  const mediaByKey = new Map<string, { name: string; bytes: Uint8Array }>();
  const mediaName = (media: MediaInput): string => {
    const key = `${media.mime}:${fnv1a(media.bytes)}:${media.bytes.length}`;
    let entry = mediaByKey.get(key);
    if (!entry) {
      const ext = media.mime === "image/png" ? "png" : "jpeg";
      entry = { name: `image${mediaByKey.size + 1}.${ext}`, bytes: media.bytes };
      mediaByKey.set(key, entry);
    }
    return entry.name;
  };

  const slideXmls: string[] = [];
  const slideRels: string[] = [];

  for (const slide of input.slides) {
    // rId1 = layout; images get rId2+ (per-slide, so ids stay small and local).
    const relForImage = new Map<string, string>(); // media file name → rId
    const rels: string[] = [
      `<Relationship Id="rId1" Type="${OPC.REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    ];
    const shapes: string[] = [];

    slide.shapes.forEach((shape, i) => {
      // cNvPr ids must be unique per slide and ≥ 2 (1 is the group header).
      const id = 2 + i;
      if (shape.kind === "picture") {
        const name = mediaName(shape.media);
        let rid = relForImage.get(name);
        if (!rid) {
          rid = `rId${rels.length + 1}`;
          relForImage.set(name, rid);
          rels.push(`<Relationship Id="${rid}" Type="${OPC.REL_TYPE}/image" Target="../media/${name}"/>`);
        }
        shapes.push(shapeXml(shape, id, rid));
      } else {
        shapes.push(shapeXml(shape, id));
      }
    });

    slideXmls.push(
      OPC.XML_DECL +
        `<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_SPTREE_HEADER}${shapes.join("")}</p:spTree></p:cSld>` +
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
    );
    slideRels.push(
      OPC.XML_DECL +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
    );
  }

  return buildPptxPackage({
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    slideXmls,
    slideRels,
    media: [...mediaByKey.values()],
  });
}

/** FNV-1a over bytes — cheap sync content hash for media dedup (not crypto). */
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
