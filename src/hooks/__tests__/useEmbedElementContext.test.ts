import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import {
  useEmbedElementContext,
  formatEmbedElementLabel,
} from "../useEmbedElementContext";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";
import type { FlatSceneNode } from "@/types/scene";

function baseSelection(
  overrides: Partial<EmbedElementSelection> = {},
): EmbedElementSelection {
  return {
    embedId: "embed1",
    path: "div:nth-of-type(1)",
    tagName: "button",
    classes: [],
    textPreview: "",
    outerHtml: "<button>Go</button>",
    ...overrides,
  };
}

function seedEmbedScene(): void {
  const embed = {
    id: "embed1",
    type: "embed",
    name: "Hero Embed",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    htmlContent: "<div>hi</div>",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { embed1: embed },
    parentById: { embed1: null },
    childrenById: {},
    rootIds: ["embed1"],
    _cachedTree: null,
  });
}

afterEach(() => {
  cleanup();
});

describe("formatEmbedElementLabel", () => {
  it("prefers #id when an elementId is present", () => {
    expect(
      formatEmbedElementLabel({
        tagName: "div",
        elementId: "hero",
        classes: ["card", "primary"],
      }),
    ).toBe("#hero");
  });

  it("falls back to tag when there are no classes", () => {
    expect(
      formatEmbedElementLabel({ tagName: "button", classes: [] }),
    ).toBe("button");
  });

  it("joins up to two classes as tag.class1.class2", () => {
    expect(
      formatEmbedElementLabel({
        tagName: "div",
        classes: ["card", "primary"],
      }),
    ).toBe("div.card.primary");
  });

  it("caps at two classes even when more are present", () => {
    expect(
      formatEmbedElementLabel({
        tagName: "div",
        classes: ["card", "primary", "extra", "another"],
      }),
    ).toBe("div.card.primary");
  });

  it("truncates a very long class name", () => {
    const longClass = "a".repeat(40);
    const label = formatEmbedElementLabel({
      tagName: "div",
      classes: [longClass],
    });
    expect(label).toBe(`div.${longClass.slice(0, 20)}…`);
    expect(label.length).toBeLessThan(longClass.length);
  });
});

describe("useEmbedElementContext", () => {
  beforeEach(() => {
    resetStores();
  });

  it("returns null when there is no selection", () => {
    const { result } = renderHook(() => useEmbedElementContext());
    expect(result.current).toBeNull();
  });

  it("returns null when the selection's embed no longer exists in the scene", () => {
    act(() => {
      useEmbedPickerStore.getState().selectElement(baseSelection());
    });
    // No seedEmbedScene() call — embed1 is absent from nodesById.
    const { result } = renderHook(() => useEmbedElementContext());
    expect(result.current).toBeNull();
  });

  it("returns the selection, label and embed name when the embed is live", () => {
    seedEmbedScene();
    act(() => {
      useEmbedPickerStore.getState().selectElement(
        baseSelection({ tagName: "button", classes: ["primary"] }),
      );
    });
    const { result } = renderHook(() => useEmbedElementContext());
    expect(result.current).toEqual({
      selection: baseSelection({ tagName: "button", classes: ["primary"] }),
      label: "button.primary",
      embedName: "Hero Embed",
    });
  });

  it("clears once the selection is cleared", () => {
    seedEmbedScene();
    act(() => {
      useEmbedPickerStore.getState().selectElement(baseSelection());
    });
    const { result, rerender } = renderHook(() => useEmbedElementContext());
    expect(result.current).not.toBeNull();

    act(() => {
      useEmbedPickerStore.getState().clearSelection();
    });
    rerender();
    expect(result.current).toBeNull();
  });
});
