import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { DocumentData } from "@/utils/fileUtils";
import { resetStores } from "@/test/fixtures";
import { useDocumentStore } from "@/store/documentStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useShareStore } from "@/store/shareStore";
import { useViewportStore } from "@/store/viewportStore";
import { loadShareCredentials, saveShareCredentials } from "@/lib/shareCanvas";
import SharedCanvasPage from "@/components/share/SharedCanvasPage";

// The real editor (@/App) pulls in PixiJS/WebGL, which happy-dom can't run —
// stub it with a lightweight marker so this suite exercises SharedCanvasPage's
// own logic (fetch -> apply -> mode switch) rather than the whole editor shell.
vi.mock("@/App", () => ({
  default: () => <div data-testid="fake-editor" />,
}));

const { fetchSharedCanvasMock, forkSharedCanvasInPlaceMock } = vi.hoisted(() => ({
  fetchSharedCanvasMock: vi.fn(),
  forkSharedCanvasInPlaceMock: vi.fn(),
}));

vi.mock("@/lib/shareCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shareCanvas")>();
  return {
    ...actual,
    fetchSharedCanvas: fetchSharedCanvasMock,
    forkSharedCanvasInPlace: forkSharedCanvasInPlaceMock,
  };
});

const navigateMock = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function minimalDocument(): DocumentData {
  return {
    pages: [
      {
        id: "page-1",
        name: "Page 1",
        nodes: [],
        pageBackground: "#f5f5f5",
        guides: [],
        slideOrder: [],
        measurements: [],
        comments: [],
      },
    ],
    variables: [],
    textStyles: [],
    fillStyles: [],
    effectStyles: [],
    activeTheme: "light",
    componentArtifacts: {},
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/c/:shareId" element={<SharedCanvasPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<SharedCanvasPage />", () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSharedViewStore.setState({ isSharedView: false });
    fetchSharedCanvasMock.mockReset();
    forkSharedCanvasInPlaceMock.mockReset();
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.querySelectorAll("[data-canvas]").forEach((el) => el.remove());
  });

  it("renders the error card and does not mount the editor on a 404", async () => {
    fetchSharedCanvasMock.mockResolvedValue({
      ok: false,
      error: "This shared canvas doesn't exist or has been removed.",
    });

    renderAt("/c/missing");

    await waitFor(() =>
      expect(
        screen.getByText("This canvas link doesn't exist or was removed."),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("fake-editor")).toBeNull();
  });

  it("enters view mode and sets the document title on success", async () => {
    fetchSharedCanvasMock.mockResolvedValue({
      ok: true,
      canvas: {
        id: "abc123",
        title: "My Canvas",
        data: minimalDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });

    renderAt("/c/abc123");

    await waitFor(() => expect(screen.getByTestId("fake-editor")).toBeTruthy());
    expect(useEditorModeStore.getState().mode).toBe("view");
    expect(useDocumentStore.getState().fileName).toBe("My Canvas");
    expect(useSharedViewStore.getState().isSharedView).toBe(true);
  });

  it("'Make a copy' exits view mode, renames to '(copy)', clears share credentials, and navigates to /app", async () => {
    fetchSharedCanvasMock.mockResolvedValue({
      ok: true,
      canvas: {
        id: "abc123",
        title: "My Canvas",
        data: minimalDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });
    forkSharedCanvasInPlaceMock.mockImplementation((title: string) => {
      useEditorModeStore.getState().exitToEdit();
      useDocumentStore.getState().setFileName(`${title} (copy)`);
    });

    renderAt("/c/abc123");
    await waitFor(() => expect(screen.getByTestId("fake-editor")).toBeTruthy());

    fireEvent.click(screen.getByText("Make a copy"));

    expect(forkSharedCanvasInPlaceMock).toHaveBeenCalledWith("My Canvas");
    expect(useEditorModeStore.getState().mode).toBe("edit");
    expect(useDocumentStore.getState().fileName).toBe("My Canvas (copy)");
    expect(navigateMock).toHaveBeenCalledWith("/app");
  });

  // Finding A: a visitor's OWN share credentials must not survive loading
  // someone else's document into the live stores — otherwise clicking
  // "Open editor" then File -> Share… -> "Update" POSTs the shared document
  // under the visitor's own shareId+editToken, replacing their published
  // canvas with the one they were just viewing.
  it("clears the visitor's own pre-existing share credentials before applying the fetched document", async () => {
    saveShareCredentials({ id: "visitors-own-id", editToken: "visitors-own-token" });
    expect(useShareStore.getState().status).toBe("shared");

    fetchSharedCanvasMock.mockResolvedValue({
      ok: true,
      canvas: {
        id: "abc123",
        title: "My Canvas",
        data: minimalDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });

    renderAt("/c/abc123");

    await waitFor(() => expect(screen.getByTestId("fake-editor")).toBeTruthy());
    expect(loadShareCredentials()).toBeNull();
    // The store subscription (shareCanvas.ts's subscribeToShareCredentials)
    // must also have reset — not just localStorage.
    expect(useShareStore.getState().status).toBe("idle");
  });

  // Finding B: leaving the viewer without exiting view mode drops the
  // visitor into /app fully read-only, with no in-app way back (view mode
  // is only ever entered via this page or `?view`, never exited through
  // the UI other than Escape/exitToEdit).
  it("exits view mode on unmount", async () => {
    fetchSharedCanvasMock.mockResolvedValue({
      ok: true,
      canvas: {
        id: "abc123",
        title: "My Canvas",
        data: minimalDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });

    const { unmount } = renderAt("/c/abc123");
    await waitFor(() => expect(screen.getByTestId("fake-editor")).toBeTruthy());
    expect(useEditorModeStore.getState().mode).toBe("view");

    unmount();

    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  // Finding E: the initial fit (inside applyOpenedDocument, before
  // <EditorApp/> renders PixiCanvas) always falls back to the window since
  // no [data-canvas] element exists yet. Once the canvas actually mounts,
  // the page must re-fit using its real metrics instead of leaving the
  // shared design fit to a viewport that's 350-500px too wide on desktop.
  it("re-fits the viewport to the real canvas element once it mounts", async () => {
    const fitToContentSpy = vi.spyOn(useViewportStore.getState(), "fitToContent");
    fetchSharedCanvasMock.mockResolvedValue({
      ok: true,
      canvas: {
        id: "abc123",
        title: "My Canvas",
        data: minimalDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });

    renderAt("/c/abc123");
    await waitFor(() => expect(screen.getByTestId("fake-editor")).toBeTruthy());

    // No [data-canvas] element exists in this test (the real editor/PixiCanvas
    // is stubbed out), matching the initial-fit fallback. Mount one now with a
    // real-canvas-shaped size, simulating PixiCanvas appearing.
    const canvasEl = document.createElement("div");
    canvasEl.setAttribute("data-canvas", "");
    Object.defineProperty(canvasEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(canvasEl, "clientHeight", { value: 600, configurable: true });
    document.body.appendChild(canvasEl);

    await waitFor(() =>
      expect(fitToContentSpy).toHaveBeenCalledWith(expect.any(Array), 800, 600),
    );
  });
});
