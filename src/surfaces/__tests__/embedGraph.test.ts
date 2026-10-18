import { describe, expect, it, vi } from "vitest";

// The embed entry reads the surface store (keyboard gates) and the
// effective-surface predicate. Those modules, and `meta`, must not drag in a
// View, the chat store or the cloud browser: anything below throws on import.
// (Other embed paths, e.g. useDesignChat via mcpDispatch, load chat code for
// their own reasons; this pins only what the SURFACE modules add.)
vi.mock("@/components/surfaces/BrowserSurfaceView", () => {
  throw new Error("surface modules must not load a View");
});
vi.mock("@/components/chat/CloudBrowserLiveView", () => {
  throw new Error("surface modules must not load a View");
});
vi.mock("@/surfaces/views", () => {
  throw new Error("surface modules must not load views.ts");
});
vi.mock("@/store/chatStore", () => {
  throw new Error("surface modules must not load the chat store");
});
vi.mock("@/lib/cloudBrowser", () => {
  throw new Error("surface modules must not load the cloud browser");
});
vi.mock("@/surfaces/canvasContext", () => {
  throw new Error("surface modules must not load the agent context builder");
});
vi.mock("@/surfaces/canvasSurface", () => {
  throw new Error("surface modules must not load tool maps");
});
vi.mock("@/lib/toolRegistry", () => {
  throw new Error("surface modules must not load the tool registry");
});

describe("surface modules in the embed graph", () => {
  it.each(["@/surfaces/meta", "@/store/surfaceStore", "@/surfaces/effectiveSurface"])(
    "%s loads without Views, chat, cloud browser or tool maps",
    async (entry) => {
      vi.resetModules();
      await expect(import(/* @vite-ignore */ entry)).resolves.toBeDefined();
    },
  );
});
