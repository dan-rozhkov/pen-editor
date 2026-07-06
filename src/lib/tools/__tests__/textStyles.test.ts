import { describe, it, expect, beforeEach } from "vitest";
import { getTextStyles } from "@/lib/tools/getTextStyles";
import { setTextStyles } from "@/lib/tools/setTextStyles";
import { applyTextStyle } from "@/lib/tools/applyTextStyle";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useSceneStore } from "@/store/sceneStore";
import type { TextNode } from "@/types/scene";
import { resetStores, seedScene, seedTextStyles } from "@/test/fixtures";

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("get_text_styles", () => {
  it("returns an empty list when no text styles exist", async () => {
    expect(JSON.parse(await getTextStyles({}))).toEqual({ textStyles: [] });
  });

  it("serializes existing text styles", async () => {
    seedTextStyles();
    const result = JSON.parse(await getTextStyles({}));
    expect(result.textStyles).toEqual([
      {
        id: "style-heading",
        name: "Heading/L",
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: "700",
        lineHeight: 1.1,
        letterSpacing: -0.5,
        textTransform: "none",
      },
    ]);
  });
});

describe("set_text_styles", () => {
  it("returns an error when no styles are provided", async () => {
    const result = JSON.parse(await setTextStyles({}));
    expect(result.error).toBe("No text styles provided");
  });

  it("creates new styles from an array of definitions", async () => {
    const result = JSON.parse(
      await setTextStyles({
        textStyles: [
          { name: "Body/M", fontFamily: "Inter", fontSize: 14 },
        ] as unknown as Record<string, unknown>,
      }),
    );
    expect(result).toEqual({ success: true, textStyleCount: 1 });
    const styles = useTextStyleStore.getState().textStyles;
    expect(styles[0]).toMatchObject({ name: "Body/M", fontFamily: "Inter", fontSize: 14 });
    expect(styles[0].id).toBeTruthy();
  });

  it("merges by name, updating existing styles and keeping their ids, and propagates to bound nodes", async () => {
    seedTextStyles();
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");

    const result = JSON.parse(
      await setTextStyles({
        textStyles: [
          { name: "Heading/L", fontSize: 48 },
        ] as unknown as Record<string, unknown>,
      }),
    );
    expect(result).toEqual({ success: true, textStyleCount: 1 });

    const styles = useTextStyleStore.getState().textStyles;
    expect(styles[0].id).toBe("style-heading");
    expect(styles[0].fontSize).toBe(48);

    const node = useSceneStore.getState().nodesById["text1"] as unknown as TextNode;
    expect(node.fontSize).toBe(48);
  });

  it("replaces the entire set when replace=true", async () => {
    seedTextStyles();
    const result = JSON.parse(
      await setTextStyles({
        textStyles: [{ name: "Only" }] as unknown as Record<string, unknown>,
        replace: true,
      }),
    );
    expect(result).toEqual({ success: true, textStyleCount: 1 });
    expect(useTextStyleStore.getState().textStyles.map((s) => s.name)).toEqual(["Only"]);
  });
});

describe("apply_text_style", () => {
  beforeEach(() => {
    seedTextStyles();
  });

  it("errors when the style is not found", async () => {
    const result = JSON.parse(
      await applyTextStyle({ nodeIds: ["text1"], textStyleId: "nope" }),
    );
    expect(result.error).toBeTruthy();
  });

  it("applies the style to every given node id", async () => {
    const result = JSON.parse(
      await applyTextStyle({ nodeIds: ["text1"], textStyleId: "style-heading" }),
    );
    expect(result).toEqual({ success: true, appliedCount: 1 });
    const node = useSceneStore.getState().nodesById["text1"] as unknown as TextNode;
    expect(node.textStyleId).toBe("style-heading");
    expect(node.fontSize).toBe(32);
  });
});
