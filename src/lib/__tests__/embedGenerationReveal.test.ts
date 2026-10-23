import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { resetStores, seedScene } from "@/test/fixtures";
import {
  __resetEmbedGenerationRevealForTests,
  claimLiveRun,
  consumeEmbedGenerationReveal,
  markEmbedForGenerationReveal,
  parkLiveRun,
} from "@/lib/embedGenerationReveal";
import type { UIGenerationLiveRun } from "@/vendor/uiGeneration/ui-generation.js";

function fakeRun(): UIGenerationLiveRun {
  return { cancel: vi.fn() } as unknown as UIGenerationLiveRun;
}

async function createdIds(operations: string): Promise<string[]> {
  const result = JSON.parse(await batchDesign({ operations }));
  return result.createdNodes.map((n: { id: string }) => n.id);
}

beforeEach(() => {
  resetStores();
  seedScene();
  __resetEmbedGenerationRevealForTests();
});

afterEach(() => {
  localStorage.removeItem("pen.generationReveal");
  vi.useRealTimers();
});

describe("embed generation reveal marks", () => {
  it("marks an embed that batch_design inserts, once", async () => {
    const [id] = await createdIds(
      'e=I(document, {type: "embed", name: "Home", width: 100, height: 100, htmlContent: "<div></div>"})',
    );

    expect(consumeEmbedGenerationReveal(id)).toBe(true);
    expect(consumeEmbedGenerationReveal(id)).toBe(false);
  });

  it("does not mark other node types", async () => {
    const [id] = await createdIds('f=I(document, {type: "frame", name: "F", width: 100, height: 100})');

    expect(consumeEmbedGenerationReveal(id)).toBe(false);
  });

  it("ignores a stale mark", () => {
    markEmbedForGenerationReveal("e1", 0);

    expect(consumeEmbedGenerationReveal("e1", 15_001)).toBe(false);
  });

  it("honours the localStorage kill switch", () => {
    localStorage.setItem("pen.generationReveal", "off");
    markEmbedForGenerationReveal("e1");

    expect(consumeEmbedGenerationReveal("e1")).toBe(false);
  });
});

describe("streaming drawing hand-over", () => {
  it.each([
    ["the stream parks first", ["park", "claim"] as const],
    ["the embed claims first", ["claim", "park"] as const],
  ])("hands the run to the claim with the same geometry when %s", (_, order) => {
    const run = fakeRun();
    const got: UIGenerationLiveRun[] = [];
    const steps = {
      park: () => parkLiveRun("0,0,390,844", run),
      claim: () => void claimLiveRun("0,0,390,844", (r) => got.push(r)),
    };
    order.forEach((step) => steps[step]());

    expect(got).toEqual([run]);
    expect(run.cancel).not.toHaveBeenCalled();
  });

  it("drops a run nobody claims", () => {
    vi.useFakeTimers();
    const run = fakeRun();
    parkLiveRun("0,0,390,844", run);
    claimLiveRun("500,0,390,844", () => {});

    vi.advanceTimersByTime(1_500);

    expect(run.cancel).toHaveBeenCalledOnce();
  });

  it("does not hand a run to a released claim", () => {
    const got: UIGenerationLiveRun[] = [];
    const release = claimLiveRun("0,0,390,844", (r) => got.push(r));
    release();
    parkLiveRun("0,0,390,844", fakeRun());

    expect(got).toEqual([]);
  });
});
