import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

let current: Editor | null = null;

const MARKDOWN = "> [!GALLERY]\n> ![First](https://x.test/1.png)\n> ![Second](https://x.test/2.png)\n> ![Third](https://x.test/3.png)";

function Harness({ editable = true, content = MARKDOWN }: { editable?: boolean; content?: string }) {
  const editor = useEditor({ extensions: DOC_EXTENSIONS, content, contentType: "markdown", editable });
  useEffect(() => {
    current = editor;
  }, [editor]);
  return <EditorContent editor={editor} />;
}

const images = () => (current?.getJSON().content?.[0].attrs?.images ?? []) as Array<{ src: string; alt: string }>;
const mount = async (props: Parameters<typeof Harness>[0] = {}) => {
  render(<Harness {...props} />);
  await screen.findByRole("group", { name: "Image gallery" });
};
const openFirst = async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Open image: First" }));
  return screen.findByRole("dialog");
};

afterEach(cleanup);

const focusInput = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Add image" }));
  const input = await screen.findByRole("textbox", { name: "Image address" });
  input.focus();
  return input;
};

describe("gallery lightbox", () => {
  it("opens the clicked image with caption and counter", async () => {
    const dialog = await openFirst();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("https://x.test/1.png");
    expect(dialog.textContent).toContain("First");
    expect(dialog.textContent).toContain("1 / 3");
  });

  it("moves with ArrowRight and the buttons", async () => {
    const dialog = await openFirst();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("2 / 3"));
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("1 / 3"));
  });

  it("closes on Escape", async () => {
    const dialog = await openFirst();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes with the close button", async () => {
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("hides prev/next for a single image", async () => {
    await mount({ content: "> [!GALLERY]\n> ![Only](https://x.test/1.png)" });
    fireEvent.click(screen.getByRole("button", { name: "Open image: Only" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
  });
});

describe("gallery editing", () => {
  it("removes an image", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove image" })[1]);
    await waitFor(() => expect(images().map((image) => image.alt)).toEqual(["First", "Third"]));
  });

  it("adds an http(s) link and rejects others", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const input = await screen.findByRole("textbox", { name: "Image address" });
    fireEvent.change(input, { target: { value: "data:image/png;base64,AAAA" } });
    fireEvent.submit(input.closest("form")!);
    expect(images()).toHaveLength(3);
    fireEvent.change(input, { target: { value: "https://x.test/4.png" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(images().at(-1)).toEqual({ src: "https://x.test/4.png", alt: "" }));
    expect(current?.getMarkdown()).toContain("> ![](https://x.test/4.png)");
  });

  it("labels an empty gallery's add tile and cancels with Escape", async () => {
    await mount({ content: "> [!GALLERY]" });
    fireEvent.click(screen.getByRole("button", { name: "Add images" }));
    const input = await screen.findByRole("textbox", { name: "Image address" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Image address" })).toBeNull());
    expect(images()).toEqual([]);
  });

  it("adds a typed valid link on blur, closes an empty field, keeps an invalid one open", async () => {
    await mount();
    let input = await focusInput();
    fireEvent.change(input, { target: { value: "https://x.test/5.png" } });
    fireEvent.blur(input);
    await waitFor(() => expect(images().at(-1)?.src).toBe("https://x.test/5.png"));
    expect(screen.queryByRole("textbox", { name: "Image address" })).toBeNull();

    input = await focusInput();
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Image address" })).toBeNull());

    input = await focusInput();
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/starts with http/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Image address" })).toBeTruthy();
    expect(images()).toHaveLength(4);
  });

  it("Escape cancels without adding the typed link", async () => {
    await mount();
    const input = await focusInput();
    fireEvent.change(input, { target: { value: "https://x.test/6.png" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Image address" })).toBeNull());
    expect(images()).toHaveLength(3);
  });

  it("opens the URL field for a fresh gallery under StrictMode and marks the selection", async () => {
    render(
      <StrictMode>
        <Harness content="Intro" />
      </StrictMode>,
    );
    await waitFor(() => expect(current).not.toBeNull());
    current!.commands.insertGallery(true);
    expect(await screen.findByRole("textbox", { name: "Image address" })).toBeTruthy();
    // ReactNodeView puts the selected class on its outer element; the inner wrapper carries data-selected.
    const wrapper = document.querySelector(".doc-gallery") as HTMLElement;
    expect(wrapper.hasAttribute("data-selected")).toBe(true);
    expect(wrapper.closest(".ProseMirror-selectednode")).not.toBeNull();
  });

  it("does not open the URL field of an unrelated gallery selected later", async () => {
    render(<Harness content={"Intro\n\n" + MARKDOWN} />);
    await waitFor(() => expect(current).not.toBeNull());
    await screen.findByRole("group", { name: "Image gallery" });
    // Ask for the field, but move the selection away before the view consumes the request.
    current!.commands.insertGallery(true);
    current!.commands.setTextSelection(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    let galleryPos = -1;
    current!.state.doc.forEach((node, offset) => {
      if (node.type.name === "imageGallery" && galleryPos < 0) galleryPos = offset;
    });
    current!.commands.setNodeSelection(galleryPos);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("textbox", { name: "Image address" })).toBeNull();
  });

  it("shows no controls when read-only", async () => {
    await mount({ editable: false });
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add image/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Open image/ })).toHaveLength(3);
  });
});
