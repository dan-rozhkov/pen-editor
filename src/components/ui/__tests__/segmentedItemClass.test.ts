import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  SEGMENTED_ITEM_ACTIVE_CLASS,
  SEGMENTED_ITEM_CLASS,
  segmentedActionClass,
  segmentedItemClass,
  segmentedToggleClass,
} from "../segmented-control";

describe("segmentedItemClass", () => {
  it("renders the inactive item with a transparent border and no raised fill", () => {
    const cls = segmentedItemClass(false);
    expect(cls).toContain("rounded-control-inset");
    expect(cls).toContain("border-transparent");
    expect(cls).not.toContain("control-raised");
  });

  it("raises the active item and swaps the transparent border for the menu hairline", () => {
    const cls = segmentedItemClass(true);
    expect(cls).toContain("control-raised");
    expect(cls).toContain("border-menu-border");
    expect(cls).not.toContain("border-transparent");
    expect(SEGMENTED_ITEM_ACTIVE_CLASS).toContain("control-raised");
    expect(SEGMENTED_ITEM_CLASS).toContain("h-6");
  });

  it("adds icon sizing and lets a caller class override", () => {
    const cls = segmentedItemClass(false, { icon: true, className: "flex-1 px-0" });
    expect(cls).toContain("[&_svg]:size-4");
    expect(cls).toContain("flex-1");
    expect(cls).toContain("px-0");
    expect(cls).not.toContain("px-1.5");
  });

  it("gives action items a hover fill but no active state", () => {
    const cls = segmentedActionClass({ icon: true });
    expect(cls).toContain("hover:bg-surface-panel");
    expect(cls).not.toContain("control-raised");
  });

  it("beats the Button default variant fill when active", () => {
    const tokens = cn(buttonVariants({ variant: "default" }), segmentedItemClass(true)).split(/\s+/);
    expect(tokens).not.toContain("bg-primary");
    expect(tokens).toContain("bg-surface-panel");
    expect(tokens).toContain("control-raised");
    expect(tokens).not.toContain("control-elevation");
  });

  it("beats the Button secondary variant fill when inactive", () => {
    const tokens = cn(buttonVariants({ variant: "secondary" }), segmentedItemClass(false)).split(/\s+/);
    expect(tokens).not.toContain("bg-secondary");
    expect(tokens).toContain("bg-transparent");
    expect(tokens).toContain("shadow-none");
  });

  it("drops the default variant's fill and sets shadow-none when inactive", () => {
    const tokens = cn(buttonVariants({ variant: "default" }), segmentedItemClass(false)).split(/\s+/);
    expect(tokens).not.toContain("bg-primary");
    expect(tokens).toContain("bg-transparent");
    expect(tokens).toContain("shadow-none");
  });

  it("keeps a transition that covers scale next to Button's press animation", () => {
    const cls = cn(buttonVariants(), segmentedItemClass(false));
    expect(cls).toMatch(/transition-\[[^\]]*scale[^\]]*\]/);
  });

  it("segmentedToggleClass raises only when active", () => {
    expect(segmentedToggleClass(true).split(/\s+/)).toContain("control-raised");
    expect(segmentedToggleClass(false).split(/\s+/)).not.toContain("control-raised");
  });
});
