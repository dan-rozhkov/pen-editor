import { render } from "@testing-library/react";
import { useSceneStore } from "@/store/sceneStore";
import type { FlatSceneNode } from "@/types/scene";
import { EmbedLayer } from "../EmbedLayer";

/** Seeds a single embed node "e1" into the scene store — the setup every
 * `<EmbedLayer />` test in this directory needs before it can render against
 * a real embed. Each call site supplies its own `htmlContent`, since the
 * shape of the embed's markup is exactly what each test varies. */
export function seedEmbedNode(htmlContent: string): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1",
        type: "embed",
        name: "Code",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],
    _cachedTree: null,
  });
}

/** Three in-flow, vertically-stacked `<div data-slot>` siblings behind a
 * sacrificial leading `<span>` — the shape both the sortable-reorder tests
 * (`EmbedLayer.elementPicker.test.tsx`) and the node-move-forward tests
 * (`EmbedLayer.nodeDragForward.test.tsx`) need. The leading `<span></span>`
 * absorbs `sanitizeEmbedHtml`'s DOMPurify pass mangling the fragment's FIRST
 * top-level node under happy-dom (see that module's own doc comment), so the
 * three real `data-slot` divs below it survive sanitization intact and line
 * up 1:1 with this raw string — a real browser's DOMPurify never needs this
 * padding. */
export const THREE_SLOT_HTML =
  "<span></span><div>" +
  '<div data-slot="1">One</div>' +
  '<div data-slot="2">Two</div>' +
  '<div data-slot="3">Three</div>' +
  "</div>";

/** Shared `PointerEvent` builder for drag/reorder tests: defaults every field
 * a gesture needs (bubbles/composed/cancelable, a primary left-button
 * pointer) so each call site only spells out what it's actually varying —
 * position, pointerId, button, or isPrimary. */
export function embedPointerEvent(
  type: string,
  init: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
  },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    ...init,
  });
}

/** Renders `<EmbedLayer />` inside the same `[data-canvas] > canvas` DOM
 * shape production code expects (`EmbedLayer.tsx`'s `findPixiCanvas`) — the
 * setup every test that asserts on wheel/pointer/touch forwarding to the
 * underlying Pixi canvas needs. Returns `cleanupCanvas` to remove the extra
 * DOM the default RTL `cleanup()` doesn't own (it was never RTL's own render
 * `container`, only its parent). */
export function renderEmbedLayerWithCanvas(): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  cleanupCanvas: () => void;
} {
  const dataCanvas = document.createElement("div");
  dataCanvas.setAttribute("data-canvas", "");
  document.body.appendChild(dataCanvas);
  const canvas = document.createElement("canvas");
  dataCanvas.appendChild(canvas);
  const mountPoint = document.createElement("div");
  dataCanvas.appendChild(mountPoint);

  const { container } = render(<EmbedLayer />, { container: mountPoint });
  return { container, canvas, cleanupCanvas: () => dataCanvas.remove() };
}
