import { describe, it, expect } from "vitest";
import { toolDisplayNames, referoToolDisplayNames } from "../toolDisplayNames";
import { getToolIcon } from "../toolIcons";
import { toolHandlers } from "../toolRegistry";
import { ReferoIcon } from "@/components/icons/ReferoIcon";
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

  it("brands every Refero-served tool with the Refero mark", () => {
    const referoTools = Object.keys(referoToolDisplayNames);
    expect(referoTools.length).toBeGreaterThan(0);
    for (const name of referoTools) {
      expect(getToolIcon(name)).toBe(ReferoIcon);
    }
  });

  it("gives every spelling of a Refero tool the same label", () => {
    // Bare, `refero_`-prefixed and `mcp_refero_`-prefixed names are the same
    // tool; they once drifted into three different labels and icons.
    for (const spelling of ["get_style", "refero_get_style", "mcp_refero_get_style"]) {
      expect(toolDisplayNames[spelling]).toBe("Open Design Style");
    }
  });
});
