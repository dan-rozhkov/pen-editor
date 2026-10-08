import { describe, it, expect, beforeEach } from "vitest";
import { resetWorld, seedEmbed } from "@/test/componentFixtures";
import { countUsage } from "../componentOps";
import type { ComponentRegistry } from "@/lib/embedComponents";

describe("countUsage", () => {
  beforeEach(() => resetWorld());

  it("counts regions (instances) and embeds holding them, per registered key", () => {
    const registry = new Map([["btn", {}], ["card", {}]]) as unknown as ComponentRegistry;
    seedEmbed("s1", `<b data-c="btn"></b><b data-c="btn"></b><i data-c="other"></i>`);
    seedEmbed("s2", `<b data-c="btn"></b>`);
    const usage = countUsage(registry);
    expect(usage.get("btn")).toEqual({ instances: 3, embeds: 2 });
    expect(usage.get("card")).toEqual({ instances: 0, embeds: 0 });
    expect(usage.has("other")).toBe(false);
  });
});
