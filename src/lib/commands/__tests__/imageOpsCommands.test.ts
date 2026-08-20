import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
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

const { canRemoveBackground, canVectorize } = vi.hoisted(() => ({
  canRemoveBackground: vi.fn(() => true),
  canVectorize: vi.fn(() => true),
}));
vi.mock("@/lib/imageOps/capabilities", () => ({ canRemoveBackground, canVectorize }));

const { getImageOpsCommands } = await import("@/lib/commands/imageOpsCommands");
const { getCommands } = await import("@/lib/commands/registry");

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
  useSelectionStore.getState().setSelectedIds([IMAGE_NODE_ID]);
}

beforeEach(() => {
  resetStores();
  canRemoveBackground.mockReturnValue(true);
  canVectorize.mockReturnValue(true);
  toastFn.mockClear();
  toastError.mockClear();
  removeBackgroundOnNode.mockReset();
  vectorizeNode.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getImageOpsCommands", () => {
  it("returns nothing when there is no valid image-op target", () => {
    expect(getImageOpsCommands()).toHaveLength(0);
  });

  it("returns both commands, in the Tools group, when a single image-filled node is selected", () => {
    seedImageNode();
    const commands = getImageOpsCommands();
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("image-ops-remove-background");
    expect(ids).toContain("image-ops-vectorize");
    expect(commands.every((c) => c.group === "Tools")).toBe(true);
    expect(commands.every((c) => c.mutatesScene)).toBe(true);
  });

  it("omits remove-background when its capability flag is off", () => {
    canRemoveBackground.mockReturnValue(false);
    seedImageNode();
    const ids = getImageOpsCommands().map((c) => c.id);
    expect(ids).not.toContain("image-ops-remove-background");
    expect(ids).toContain("image-ops-vectorize");
  });

  it("omits vectorize when its capability flag is off", () => {
    canVectorize.mockReturnValue(false);
    seedImageNode();
    const ids = getImageOpsCommands().map((c) => c.id);
    expect(ids).toContain("image-ops-remove-background");
    expect(ids).not.toContain("image-ops-vectorize");
  });

  it("is included in getCommands()'s full list under the same conditions", () => {
    seedImageNode();
    const ids = getCommands().map((c) => c.id);
    expect(ids).toContain("image-ops-remove-background");
    expect(ids).toContain("image-ops-vectorize");
  });

  it("running the remove-background command calls removeBackgroundOnNode with the target id", async () => {
    removeBackgroundOnNode.mockResolvedValue({ url: "https://example.com/b.png" });
    seedImageNode();
    const command = getImageOpsCommands().find((c) => c.id === "image-ops-remove-background")!;
    command.run();
    await vi.waitFor(() => expect(removeBackgroundOnNode).toHaveBeenCalledWith(IMAGE_NODE_ID));
  });

  it("running the vectorize command calls vectorizeNode with mode layers and reports tooComplex informationally", async () => {
    vectorizeNode.mockResolvedValue({ url: "https://example.com/b.svg", tooComplex: true, nodeCount: 900 });
    seedImageNode();
    const command = getImageOpsCommands().find((c) => c.id === "image-ops-vectorize")!;
    command.run();
    await vi.waitFor(() => expect(vectorizeNode).toHaveBeenCalledWith(IMAGE_NODE_ID, { mode: "layers" }));
    await vi.waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("running a command that rejects reports an error toast instead of throwing", async () => {
    removeBackgroundOnNode.mockRejectedValue(new Error("boom"));
    seedImageNode();
    const command = getImageOpsCommands().find((c) => c.id === "image-ops-remove-background")!;
    expect(() => command.run()).not.toThrow();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
  });
});
