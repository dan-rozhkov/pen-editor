import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { EmbedComponentRegionActions } from "../EmbedComponentRegionActions";
import { ReadOnlyContext } from "@/hooks/useReadOnly";
import { defineComponent } from "@/lib/tools/components";
import { finalizeEmbedHtml } from "@/lib/embedComponents";
import { sourcePathToShadowPath } from "@/lib/embedLayerTree";
import { BTN_HTML, CARD_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import { activeHtml, resetWorld, seedEmbed } from "@/test/componentFixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SECTION = "main:nth-of-type(1) > section:nth-of-type(1)";
const SLOT_P = `${SECTION} > div:nth-of-type(1) > p:nth-of-type(1)`;
const H1 = "main:nth-of-type(1) > h1:nth-of-type(1)";

let html = "";

beforeEach(async () => {
  resetWorld();
  vi.clearAllMocks();
  await defineComponent({ key: "card", name: "Card", html: CARD_HTML });
  await defineComponent({ key: "btn", name: "Button", html: BTN_HTML });
  const out = finalizeEmbedHtml(
    `<main><h1>Home</h1><c-card><c-slot name="body"><p>Body</p></c-slot></c-card></main>`,
    { registry: selectComponentRegistry() },
  );
  html = out.ok ? out.html : "";
  usePageStore.getState().switchToPage("p1");
  seedEmbed("s1", html);
});
afterEach(() => cleanup());

function renderActions(sourcePath: string, readOnly = false) {
  return render(
    <ReadOnlyContext.Provider value={readOnly}>
      <EmbedComponentRegionActions embedId="s1" path={sourcePathToShadowPath(sourcePath, html)} htmlContent={html} />
    </ReadOnlyContext.Provider>,
  );
}

describe("<EmbedComponentRegionActions />", () => {
  it("offers both actions for an element in a managed zone", () => {
    renderActions(SECTION);
    expect(screen.getByText(/Part of the main component Card/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit main component" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });

  it("renders nothing for slot content and for plain HTML", () => {
    const slot = renderActions(SLOT_P);
    expect(slot.container.textContent).toBe("");
    slot.unmount();
    const plain = renderActions(H1);
    expect(plain.container.textContent).toBe("");
  });

  it("renders nothing when the picked embed is itself a master", () => {
    const master = selectComponentRegistry().get("card")!;
    usePageStore.getState().switchToPage(master.pageId!);
    const { container } = render(
      <EmbedComponentRegionActions embedId={master.nodeId!} path={sourcePathToShadowPath("section:nth-of-type(1)", master.html)} htmlContent={master.html} />,
    );
    expect(container.textContent).toBe("");
  });

  it("navigates to the master", () => {
    renderActions(SECTION);
    fireEvent.click(screen.getByRole("button", { name: "Edit main component" }));
    const master = selectComponentRegistry().get("card")!;
    expect(usePageStore.getState().activePageId).toBe(master.pageId);
    expect(useSelectionStore.getState().selectedIds).toEqual([master.nodeId]);
  });

  it("detaches the instance and keeps the markup", async () => {
    renderActions(SECTION);
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const after = activeHtml("s1");
    expect(after).not.toContain("data-c=");
    expect(after).toContain("<p>Body</p>");
  });

  it("disables Detach in read-only mode", () => {
    renderActions(SECTION, true);
    expect((screen.getByRole("button", { name: "Detach" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
