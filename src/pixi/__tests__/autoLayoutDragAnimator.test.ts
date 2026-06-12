import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Container } from "pixi.js";
import type { AutoLayoutDragAnimatorConfig } from "@/pixi/autoLayoutDragAnimator";

// The animator resolves containers through pixiSync's module-level accessors.
// Mock them (and the render scheduler) so no PixiJS code is ever loaded —
// FakeContainer implements just the surface the animator touches.
const h = vi.hoisted(() => ({
  containers: new Map<string, unknown>(),
  sceneRoot: null as unknown,
}));

vi.mock("@/pixi/pixiSync", () => ({
  getNodeContainer: (id: string) => h.containers.get(id) ?? null,
  getSceneRoot: () => h.sceneRoot,
}));
vi.mock("@/pixi/renderScheduler", () => ({
  requestCanvasRender: () => {},
}));

import { createAutoLayoutDragAnimator } from "@/pixi/autoLayoutDragAnimator";

class FakeContainer {
  label = "";
  alpha = 1;
  destroyed = false;
  parent: FakeContainer | null = null;
  children: FakeContainer[] = [];
  position: { x: number; y: number; set: (x: number, y: number) => void };

  constructor(x = 0, y = 0) {
    const pos = { x, y, set: (nx: number, ny: number) => { pos.x = nx; pos.y = ny; } };
    this.position = pos;
  }

  addChild(child: FakeContainer): void {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
  }

  addChildAt(child: FakeContainer, index: number): void {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.splice(index, 0, child);
  }

  removeChild(child: FakeContainer): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }
}

const asContainer = (c: FakeContainer): Container => c as unknown as Container;
void asContainer;

// Scene fixture: an auto-layout frame at world (300, 200); its children host
// holds the dragged node at frame-local (20, 30) plus two siblings below it.
const PARENT_ABS = { x: 300, y: 200 };
const DRAGGED_LOCAL = { x: 20, y: 30 };

let sceneRoot: FakeContainer;
let childrenHost: FakeContainer;
let dragged: FakeContainer;
let sib1: FakeContainer;
let sib2: FakeContainer;

function makeConfig(
  overrides: Partial<AutoLayoutDragAnimatorConfig> = {},
): AutoLayoutDragAnimatorConfig {
  return {
    draggedId: "dragged",
    parentId: "frame",
    siblingIds: ["sib1", "sib2"],
    noGapPositions: new Map([
      ["sib1", { x: 20, y: 30 }],
      ["sib2", { x: 20, y: 90 }],
    ]),
    originalPositions: new Map([
      ["sib1", { x: 20, y: 90 }],
      ["sib2", { x: 20, y: 150 }],
    ]),
    draggedMainAxisSize: 50,
    gap: 10,
    isHorizontal: false,
    startAbsX: PARENT_ABS.x + DRAGGED_LOCAL.x,
    startAbsY: PARENT_ABS.y + DRAGGED_LOCAL.y,
    startWorldX: 330,
    startWorldY: 240,
    parentAbsX: PARENT_ABS.x,
    parentAbsY: PARENT_ABS.y,
    ...overrides,
  };
}

beforeEach(() => {
  // Keep RAF inert so the sibling lerp never runs a frame — these tests assert
  // the synchronous reparent/restore behavior only.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});

  sceneRoot = new FakeContainer();
  childrenHost = new FakeContainer();
  dragged = new FakeContainer(DRAGGED_LOCAL.x, DRAGGED_LOCAL.y);
  sib1 = new FakeContainer(20, 90);
  sib2 = new FakeContainer(20, 150);
  childrenHost.addChild(dragged);
  childrenHost.addChild(sib1);
  childrenHost.addChild(sib2);

  h.sceneRoot = sceneRoot;
  h.containers.clear();
  h.containers.set("dragged", dragged);
  h.containers.set("sib1", sib1);
  h.containers.set("sib2", sib2);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("autoLayoutDragAnimator ghost restore", () => {
  it("start() lifts the ghost to sceneRoot at world coordinates", () => {
    const animator = createAutoLayoutDragAnimator();
    animator.start(makeConfig());

    expect(dragged.parent).toBe(sceneRoot);
    expect(dragged.position.x).toBe(PARENT_ABS.x + DRAGGED_LOCAL.x);
    expect(dragged.position.y).toBe(PARENT_ABS.y + DRAGGED_LOCAL.y);
    expect(dragged.alpha).toBe(0.5);
  });

  it("destroy() right after start() returns the ghost to frame-local coordinates", () => {
    // Regression: a destroy without any movement (e.g. a click) used to leave
    // the ghost at world coordinates inside the children host, shifting the
    // node right-down by the frame's absolute position.
    const animator = createAutoLayoutDragAnimator();
    animator.start(makeConfig());
    animator.destroy();

    expect(dragged.parent).toBe(childrenHost);
    expect(dragged.position.x).toBe(DRAGGED_LOCAL.x);
    expect(dragged.position.y).toBe(DRAGGED_LOCAL.y);
    expect(dragged.alpha).toBe(1);
  });

  it("destroy() after movement converts the ghost's world position to frame-local", () => {
    const animator = createAutoLayoutDragAnimator();
    const cfg = makeConfig();
    animator.start(cfg);
    // Move the cursor by (+50, +40): ghost follows in world space.
    animator.updateCursorWorld(cfg.startWorldX + 50, cfg.startWorldY + 40);
    expect(dragged.position.x).toBe(cfg.startAbsX + 50);
    expect(dragged.position.y).toBe(cfg.startAbsY + 40);

    animator.destroy();

    expect(dragged.parent).toBe(childrenHost);
    expect(dragged.position.x).toBe(DRAGGED_LOCAL.x + 50);
    expect(dragged.position.y).toBe(DRAGGED_LOCAL.y + 40);
  });

  it("cancel() restores the ghost to its original local position and siblings to their layout positions", () => {
    const animator = createAutoLayoutDragAnimator();
    const cfg = makeConfig();
    animator.start(cfg);
    animator.updateCursorWorld(cfg.startWorldX + 120, cfg.startWorldY + 80);
    // Simulate sibling displacement from the lerp loop.
    sib1.position.set(20, 30);
    sib2.position.set(20, 90);

    animator.cancel();

    expect(dragged.parent).toBe(childrenHost);
    expect(dragged.position.x).toBe(DRAGGED_LOCAL.x);
    expect(dragged.position.y).toBe(DRAGGED_LOCAL.y);
    expect(dragged.alpha).toBe(1);
    expect(sib1.position).toMatchObject({ x: 20, y: 90 });
    expect(sib2.position).toMatchObject({ x: 20, y: 150 });
  });

  it("destroy() after cancel() does not move anything again", () => {
    const animator = createAutoLayoutDragAnimator();
    animator.start(makeConfig());
    animator.cancel();
    animator.destroy();

    expect(dragged.parent).toBe(childrenHost);
    expect(dragged.position.x).toBe(DRAGGED_LOCAL.x);
    expect(dragged.position.y).toBe(DRAGGED_LOCAL.y);
  });
});
