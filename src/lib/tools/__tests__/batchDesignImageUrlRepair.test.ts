import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { recordIssuedImageUrl, resetIssuedImageUrls } from "@/lib/tools/generateImage/registry";
import type { EmbedNode } from "@/types/scene";

const BASE = "https://s3.example.com/bucket/pen-editor";
const ISSUED = `${BASE}/dbfc34e2-504b-406f-9ad1-e860af50a7f4.jpg`;
// One character off from ISSUED (50a7f4 -> 70a7f4) — the real transcription
// slip this whole feature exists to fix.
const TYPO = `${BASE}/dbfc34e2-504b-406f-9ad1-e860af70a7f4.jpg`;

function embedHtml(id: string) {
  return (sceneState().nodesById[id] as EmbedNode).htmlContent;
}

function sceneState() {
  return useSceneStore.getState();
}

beforeEach(() => {
  resetStores();
  seedScene();
  resetIssuedImageUrls();
});

afterEach(() => {
  resetIssuedImageUrls();
});

describe("batch_design image url repair", () => {
  it("repairs a mistyped generated image url in a created embed and reports it", async () => {
    recordIssuedImageUrl(ISSUED);

    const result = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, ' +
          `htmlContent: "<img src="${TYPO}">"})`,
      }),
    );

    expect(result.success).toBe(true);
    expect(embedHtml(result.createdNodes[0].id)).toBe(`<img src="${ISSUED}">`);
    expect(result.imageUrlRepair).toBe("repaired 1 mistyped image url(s)");
  });

  it("repairs a mistyped url in an updated embed's htmlContent", async () => {
    recordIssuedImageUrl(ISSUED);

    const created = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, htmlContent: "<div></div>"})',
      }),
    );
    const id = created.createdNodes[0].id;

    const updated = JSON.parse(
      await batchDesign({
        operations: `U("${id}", {htmlContent: "<img src="${TYPO}">"})`,
      }),
    );

    expect(updated.success).toBe(true);
    expect(embedHtml(id)).toBe(`<img src="${ISSUED}">`);
    expect(updated.imageUrlRepair).toBe("repaired 1 mistyped image url(s)");
  });

  it("leaves a picsum/CDN url alone and reports no repair", async () => {
    recordIssuedImageUrl(ISSUED);
    const picsum = "https://picsum.photos/seed/skyline9/400/300";

    const result = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, ' +
          `htmlContent: "<img src="${picsum}">"})`,
      }),
    );

    expect(result.success).toBe(true);
    expect(embedHtml(result.createdNodes[0].id)).toBe(`<img src="${picsum}">`);
    expect(result.imageUrlRepair).toBeUndefined();
  });

  it("leaves a wholly invented, unrelated url alone but flags it as an issue", async () => {
    recordIssuedImageUrl(ISSUED);
    const invented = `${BASE}/00000000-0000-0000-0000-000000000000.jpg`;

    const result = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, ' +
          `htmlContent: "<img src="${invented}">"})`,
      }),
    );

    expect(result.success).toBe(true);
    expect(embedHtml(result.createdNodes[0].id)).toBe(`<img src="${invented}">`);
    expect(result.imageUrlRepair).toBeUndefined();
    // Too far off to auto-snap — the model still needs to hear this url is
    // broken, or it never finds out short of the image rendering blank.
    expect(result.issues).toBeDefined();
    expect(result.issues.some((issue: string) => issue.includes(invented))).toBe(true);
  });

  it("changes nothing when the session registry is empty", async () => {
    const result = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, ' +
          `htmlContent: "<img src="${TYPO}">"})`,
      }),
    );

    expect(result.success).toBe(true);
    expect(embedHtml(result.createdNodes[0].id)).toBe(`<img src="${TYPO}">`);
    expect(result.imageUrlRepair).toBeUndefined();
  });

  it("does NOT touch htmlContent (or report a repair) on an update that never supplied htmlContent", async () => {
    // Create the embed with the typo present, but with an empty registry so
    // creation itself doesn't repair it — this reproduces "already-persisted
    // stale HTML", the case an unrelated later update must leave alone.
    const created = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, ' +
          `htmlContent: "<img src="${TYPO}">"})`,
      }),
    );
    const id = created.createdNodes[0].id;
    expect(embedHtml(id)).toBe(`<img src="${TYPO}">`);

    recordIssuedImageUrl(ISSUED);

    const updated = JSON.parse(
      await batchDesign({ operations: `U("${id}", {x: 10})` }),
    );

    expect(updated.success).toBe(true);
    expect(updated.imageUrlRepair).toBeUndefined();
    // Still the typo — an update that only moved the node must not rewrite
    // HTML the model didn't touch this turn.
    expect(embedHtml(id)).toBe(`<img src="${TYPO}">`);
  });

  it("still repairs when the update DOES supply htmlContent (both directions covered)", async () => {
    recordIssuedImageUrl(ISSUED);

    const created = JSON.parse(
      await batchDesign({
        operations:
          'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, htmlContent: "<div></div>"})',
      }),
    );
    const id = created.createdNodes[0].id;

    const updated = JSON.parse(
      await batchDesign({
        operations: `U("${id}", {htmlContent: "<img src="${TYPO}">"})`,
      }),
    );

    expect(updated.success).toBe(true);
    expect(updated.imageUrlRepair).toBe("repaired 1 mistyped image url(s)");
    expect(embedHtml(id)).toBe(`<img src="${ISSUED}">`);
  });
});
