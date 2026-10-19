import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DocPage from "@/routes/DocPage";
import { LocationProbe } from "@/test/LocationProbe";
import { createDoc, deleteDoc, getDoc, listDocs, updateDoc } from "@/lib/docs/docStore";

function renderDoc(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DocPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("DocPage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the empty state without documents", () => {
    renderDoc("/doc");
    expect(screen.getByText("No documents yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /New document/ })).toBeTruthy();
  });

  it("creates a document from the empty state and puts its id in the URL", async () => {
    renderDoc("/doc?chat=off");
    fireEvent.click(screen.getByRole("button", { name: /New document/ }));
    const [doc] = listDocs();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${doc.id}`));
    expect(screen.getByTestId("location").textContent).toContain("chat=off");
    expect((screen.getByLabelText("Title") as HTMLTextAreaElement).value).toBe("Untitled");
  });

  it("has a title field in the page and no fixed formatting toolbar", async () => {
    const doc = createDoc({ title: "Notes", markdown: "body" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    await screen.findByLabelText("Document");
    expect(screen.getByLabelText("Title").tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("saves the title typed in the page", async () => {
    const doc = createDoc({ title: "Notes", markdown: "body" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    await waitFor(() => expect(getDoc(doc.id)?.title).toBe("Renamed"), { timeout: 1500 });
  });

  it("moves focus from the title into the editor on Enter", async () => {
    const doc = createDoc({ title: "Notes", markdown: "body" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    const editable = await screen.findByLabelText("Document");
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(editable));
  });

  it("loads the document from ?id= and sets the page title", async () => {
    createDoc({ title: "Older", markdown: "old" }, "editor");
    const target = createDoc({ title: "Target", markdown: "# Hello\n\nworld" }, "editor");
    createDoc({ title: "Newest", markdown: "new" }, "editor");
    renderDoc(`/doc?id=${target.id}`);
    expect((screen.getByLabelText("Title") as HTMLTextAreaElement).value).toBe("Target");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy());
    expect(document.title).toBe("Target");
  });

  it("opens the newest document when no id is given", async () => {
    createDoc({ title: "Older", markdown: "old" }, "editor");
    const newest = createDoc({ title: "Newest", markdown: "new" }, "editor");
    renderDoc("/doc");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${newest.id}`));
  });

  it("replaces the content when the agent writes the current document", async () => {
    const doc = createDoc({ title: "Notes", markdown: "before" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    await waitFor(() => expect(screen.getByText("before")).toBeTruthy());
    act(() => {
      updateDoc(doc.id, { markdown: "# After\n\nagent text" }, "agent");
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "After" })).toBeTruthy());
    expect(screen.queryByText("before")).toBeNull();
    // The replace must not echo back as an editor save.
    expect(getDoc(doc.id)?.markdown).toBe("# After\n\nagent text");
  });

  it("falls back to the newest document when the current one is deleted elsewhere", async () => {
    const keep = createDoc({ title: "Keep", markdown: "keep" }, "editor");
    const gone = createDoc({ title: "Gone", markdown: "gone" }, "editor");
    renderDoc(`/doc?id=${gone.id}`);
    await waitFor(() => expect(screen.getByText("gone")).toBeTruthy());
    act(() => deleteDoc(gone.id, "agent"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${keep.id}`));
  });

  it("switching documents updates the URL and keeps other params", async () => {
    const a = createDoc({ title: "Alpha", markdown: "a" }, "editor");
    createDoc({ title: "Beta", markdown: "b" }, "editor");
    renderDoc("/doc?chat=off");
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Alpha" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${a.id}`));
    expect(screen.getByTestId("location").textContent).toContain("chat=off");
  });

  it("treats any other writer as remote, whatever its source label says", async () => {
    const doc = createDoc({ title: "Notes", markdown: "before" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    await waitFor(() => expect(screen.getByText("before")).toBeTruthy());
    act(() => {
      updateDoc(doc.id, { markdown: "# Other tab" }, "editor");
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Other tab" })).toBeTruthy());
  });

  /** Opens a "before" doc and types `text` into it; the edit is pending (not yet saved). */
  async function openWithPendingEdit(text: string) {
    const doc = createDoc({ title: "Notes", markdown: "before" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    const editable = (await screen.findByLabelText("Document")) as HTMLElement;
    await waitFor(() => expect(screen.getByText("before")).toBeTruthy());
    act(() => {
      editable.textContent = text;
    });
    await new Promise((r) => setTimeout(r, 30)); // let ProseMirror's mutation observer pick it up
    return doc;
  }

  it("lets the stored version win when it changed under a pending edit", async () => {
    // Local edit (pending), then an agent write lands before the debounce fires.
    const doc = await openWithPendingEdit("before plus typing");
    act(() => {
      updateDoc(doc.id, { markdown: "agent wrote this" }, "agent");
    });
    await new Promise((r) => setTimeout(r, 450));
    expect(getDoc(doc.id)?.markdown).toBe("agent wrote this");
  });

  it("creates one document for ?new=1 (even under StrictMode) and swaps it for the id", async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/doc?new=1&chat=off"]}>
          <DocPage />
          <LocationProbe />
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(listDocs()).toHaveLength(1));
    const [doc] = listDocs();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${doc.id}`));
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("chat=off");
    expect(location).not.toContain("new=");
    expect(listDocs()).toHaveLength(1);
  });

  it("asks before deleting a document", async () => {
    const doc = createDoc({ title: "Doomed", markdown: "x" }, "editor");
    renderDoc(`/doc?id=${doc.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Document options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete document/ }));
    await screen.findByText("This cannot be undone.");
    expect(getDoc(doc.id)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(getDoc(doc.id)).toBeNull());
  });

  it("flushes a pending edit on pagehide", async () => {
    const doc = await openWithPendingEdit("typed just now");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(getDoc(doc.id)?.markdown).toContain("typed just now");
  });
});
