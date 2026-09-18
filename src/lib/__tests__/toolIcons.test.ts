import { describe, it, expect } from "vitest";
import { toolDisplayNames, mobbinToolDisplayNames } from "../toolDisplayNames";
import { getToolIcon } from "../toolIcons";
import { toolHandlers } from "../toolRegistry";
import { MobbinIcon } from "@/components/icons/MobbinIcon";
import { BinocularsIcon, NotePencilIcon } from "@phosphor-icons/react";

describe("toolIcons", () => {
  it("has a dedicated icon for every named tool", () => {
    const generic = getToolIcon("definitely_not_a_tool");
    const missing = Object.keys(toolDisplayNames).filter(
      (name) => getToolIcon(name) === generic
    );
    expect(missing).toEqual([]);
  });

  it("has a readable name and dedicated icon for every design-agent tool", () => {
    const generic = getToolIcon("definitely_not_a_tool");
    const unreadableNames = Object.keys(toolHandlers).filter(
      (name) =>
        !toolDisplayNames[name] ||
        toolDisplayNames[name] === name ||
        toolDisplayNames[name].includes("_")
    );
    const missingIcons = Object.keys(toolHandlers).filter(
      (name) => getToolIcon(name) === generic
    );

    expect(unreadableNames).toEqual([]);
    expect(missingIcons).toEqual([]);
  });

  it("covers optional backend-executed tools shown in design chat", () => {
    const generic = getToolIcon("definitely_not_a_tool");
    const optionalTools = [
      "web_search",
      "fetch_url",
      "load_skill",
      "memory",
      "skill_manage",
    ];

    for (const name of optionalTools) {
      expect(toolDisplayNames[name]).toBeTruthy();
      expect(getToolIcon(name)).not.toBe(generic);
    }
  });

  it("falls back to a generic icon for an unmapped tool", () => {
    expect(getToolIcon("some_future_tool")).toBeTruthy();
  });

  it("presents embed implementation tools as design actions", () => {
    expect(toolDisplayNames.read_embed_html).toBe("Explore Design");
    expect(toolDisplayNames.edit_embed_html).toBe("Make Changes to Design");
    expect(getToolIcon("read_embed_html")).toBe(BinocularsIcon);
    expect(getToolIcon("edit_embed_html")).toBe(NotePencilIcon);
  });

  it("brands every Mobbin-served tool with the Mobbin mark", () => {
    const mobbinTools = Object.keys(mobbinToolDisplayNames);
    expect(mobbinTools.length).toBeGreaterThan(0);
    for (const name of mobbinTools) {
      expect(getToolIcon(name)).toBe(MobbinIcon);
    }
  });

  it("gives every spelling of a Mobbin tool the same label", () => {
    // Bare, `mobbin_`-prefixed and `mcp_mobbin_`-prefixed names are the same
    // tool; the Refero tool set this replaced once drifted into three
    // different labels and icons for exactly this reason.
    for (const spelling of ["search_flows", "mobbin_search_flows", "mcp_mobbin_search_flows"]) {
      expect(toolDisplayNames[spelling]).toBe("Searching flows");
    }
  });
});
