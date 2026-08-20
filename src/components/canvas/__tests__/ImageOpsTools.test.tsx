import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { ReadOnlyContext } from "@/hooks/useReadOnly";
import type { FlatSceneNode } from "@/types/scene";

const { toastFn, toastError } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(toastFn, { error: toastError, success: vi.fn() }),
}));

const { removeBackgroundOnNode, vectorizeNode } = vi.hoisted(() => ({
  removeBackgroundOnNode: vi.fn(),
  vectorizeNode: vi.fn(),
}));
vi.mock("@/lib/imageOps/removeBackground", () => ({ removeBackgroundOnNode }));
vi.mock("@/lib/imageOps/vectorize", () => ({ vectorizeNode }));

const { canRemoveBackground, canVectorize, subscribeModels } = vi.hoisted(() => ({
  canRemoveBackground: vi.fn(() => true),
  canVectorize: vi.fn(() => true),
  subscribeModels: vi.fn(() => () => {}),
}));
vi.mock("@/lib/imageOps/capabilities", () => ({ canRemoveBackground, canVectorize }));
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return { ...actual, subscribeModels };
});

import { ImageOpsTools } from "../ImageOpsTools";

const IMAGE_NODE_ID = "img1";

function seedImageNode(): void {
  const imageNode = {
    id: IMAGE_NODE_ID,
    type: "rect",
    name: "Photo",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [{ id: "paint1", type: "image", image: { url: "https://example.com/a.png", mode: "fill" } }],
  } as unknown as FlatSceneNode;

  useSceneStore.setState((state) => ({
    nodesById: { ...state.nodesById, [IMAGE_NODE_ID]: imageNode },
    parentById: { ...state.parentById, [IMAGE_NODE_ID]: null },
    rootIds: [...state.rootIds, IMAGE_NODE_ID],
  }));
}

function selectImageNode(): void {
  useSelectionStore.getState().setSelectedIds([IMAGE_NODE_ID]);
}

function renderWithReadOnly(readOnly: boolean) {
  return render(
    <ReadOnlyContext.Provider value={readOnly}>
      <ImageOpsTools />
    </ReadOnlyContext.Provider>,
  );
}

beforeEach(() => {
  resetStores();
  canRemoveBackground.mockReturnValue(true);
  canVectorize.mockReturnValue(true);
  toastFn.mockClear();
  toastError.mockClear();
  removeBackgroundOnNode.mockReset();
  vectorizeNode.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(() => {
  cleanup();
});

describe("<ImageOpsTools />", () => {
  it("renders nothing when nothing is selected", () => {
    seedScene();
    const { container } = render(<ImageOpsTools />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the selected node has no image fill", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect1"]);
    const { container } = render(<ImageOpsTools />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when two nodes are selected, even if one has an image fill", () => {
    seedScene();
    seedImageNode();
    useSelectionStore.getState().setSelectedIds([IMAGE_NODE_ID, "rect1"]);
    const { container } = render(<ImageOpsTools />);
    expect(container.firstChild).toBeNull();
  });

  it("shows both buttons when a single image-filled node is selected and both flags are on", () => {
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);
    expect(screen.getByLabelText("Remove background")).toBeTruthy();
    expect(screen.getByLabelText("Vectorize")).toBeTruthy();
  });

  it("shows only Remove background when vectorize is unavailable", () => {
    canVectorize.mockReturnValue(false);
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);
    expect(screen.getByLabelText("Remove background")).toBeTruthy();
    expect(screen.queryByLabelText("Vectorize")).toBeNull();
  });

  it("shows only Vectorize when remove-background is unavailable", () => {
    canRemoveBackground.mockReturnValue(false);
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);
    expect(screen.queryByLabelText("Remove background")).toBeNull();
    expect(screen.getByLabelText("Vectorize")).toBeTruthy();
  });

  it("disables both buttons in read-only mode", () => {
    seedImageNode();
    selectImageNode();
    renderWithReadOnly(true);
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.disabled).toBe(true);
  });

  it("disables both buttons while offline", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.disabled).toBe(true);
  });

  it("calls removeBackgroundOnNode on click and disables the button while pending", async () => {
    let resolve!: (v: { url: string }) => void;
    removeBackgroundOnNode.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);

    const button = screen.getByLabelText("Remove background") as HTMLButtonElement;
    fireEvent.click(button);

    expect(removeBackgroundOnNode).toHaveBeenCalledWith(IMAGE_NODE_ID);
    expect(button.disabled).toBe(true);

    resolve({ url: "https://example.com/b.png" });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("calls vectorizeNode on click and disables the button while pending", async () => {
    let resolve!: (v: unknown) => void;
    vectorizeNode.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);

    const button = screen.getByLabelText("Vectorize") as HTMLButtonElement;
    fireEvent.click(button);

    expect(vectorizeNode).toHaveBeenCalledWith(IMAGE_NODE_ID, { mode: "layers" });
    expect(button.disabled).toBe(true);

    resolve({ url: "https://example.com/b.svg", nodeCount: 3 });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("shows an error toast and re-enables the button when the operation rejects", async () => {
    removeBackgroundOnNode.mockRejectedValue(new Error("network blew up"));
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);

    const button = screen.getByLabelText("Remove background") as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("network blew up"));
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("shows an informational toast (not an error) when vectorize reports tooComplex", async () => {
    vectorizeNode.mockResolvedValue({ url: "https://example.com/b.svg", tooComplex: true, nodeCount: 900 });
    seedImageNode();
    selectImageNode();
    render(<ImageOpsTools />);

    const button = screen.getByLabelText("Vectorize") as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    expect(String(toastFn.mock.calls[0][0])).toContain("900");
  });
});
