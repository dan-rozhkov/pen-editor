import { create } from "zustand";
import { captureLayers, type Plane } from "@/pixi/layers3d/captureLayers";

export const DEFAULT_ROTATE_X = 8;
export const DEFAULT_ROTATE_Y = -24;
export const DEFAULT_SPACING = 40;
export const MIN_SPACING = 8;
export const MAX_SPACING = 160;
export const ROTATE_CLAMP = 60;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

interface Layers3DState {
  active: boolean;
  targetFrameId: string | null;
  planes: Plane[];
  rotateX: number;
  rotateY: number;
  spacing: number;
  zoom: number;
  hoveredPlaneId: string | null;
  enter: (frameId: string) => Promise<void>;
  exit: () => void;
  setRotation: (x: number, y: number) => void;
  setSpacing: (px: number) => void;
  setZoom: (z: number) => void;
  setHovered: (id: string | null) => void;
  resetView: () => void;
}

const defaultView = {
  rotateX: DEFAULT_ROTATE_X,
  rotateY: DEFAULT_ROTATE_Y,
  spacing: DEFAULT_SPACING,
  zoom: 1,
};

export const useLayers3DStore = create<Layers3DState>((set, get) => ({
  active: false,
  targetFrameId: null,
  planes: [],
  ...defaultView,
  hoveredPlaneId: null,

  enter: async (frameId) => {
    set({
      active: true,
      targetFrameId: frameId,
      ...defaultView,
      hoveredPlaneId: null,
    });
    const planes = await captureLayers(frameId);
    // Guard against a race where the user exited (or entered a different
    // frame) while the capture was in flight.
    if (get().active && get().targetFrameId === frameId) {
      set({ planes });
    } else {
      planes.forEach((p) => URL.revokeObjectURL(p.imageUrl));
    }
  },

  exit: () => {
    get().planes.forEach((p) => URL.revokeObjectURL(p.imageUrl));
    set({
      active: false,
      targetFrameId: null,
      planes: [],
      hoveredPlaneId: null,
      ...defaultView,
    });
  },

  setRotation: (x, y) =>
    set({
      rotateX: clamp(x, -ROTATE_CLAMP, ROTATE_CLAMP),
      rotateY: clamp(y, -ROTATE_CLAMP, ROTATE_CLAMP),
    }),
  setSpacing: (px) => set({ spacing: clamp(px, MIN_SPACING, MAX_SPACING) }),
  setZoom: (z) => set({ zoom: clamp(z, MIN_ZOOM, MAX_ZOOM) }),
  setHovered: (id) => set({ hoveredPlaneId: id }),
  resetView: () => set({ ...defaultView }),
}));
