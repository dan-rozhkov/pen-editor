import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FontUploadButton } from "../FontUploadButton";

// The store touches IndexedDB + FontFace; stub it so the test exercises only
// the button's wiring (click → file dialog → addCustomFont → onUploaded).
const { addCustomFont } = vi.hoisted(() => ({ addCustomFont: vi.fn() }));
vi.mock("@/store/customFontStore", () => ({
  useCustomFontStore: (selector: (s: { addCustomFont: unknown }) => unknown) =>
    selector({ addCustomFont }),
}));

function fontFile(name = "Brand.ttf") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "font/ttf" });
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  addCustomFont.mockReset();
});

afterEach(cleanup);

describe("<FontUploadButton />", () => {
  it("renders an upload button and a hidden font-file input", () => {
    render(<FontUploadButton />);
    expect(screen.getByRole("button", { name: "Upload font" })).toBeTruthy();
    const input = fileInput();
    expect(input).toBeTruthy();
    expect(input.accept).toBe(".ttf,.otf,.woff,.woff2");
    expect(input.className).toContain("hidden");
  });

  it("opens the file dialog when the button is clicked", () => {
    render(<FontUploadButton />);
    const clickSpy = vi.spyOn(fileInput(), "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload font" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("registers the file and reports the family on success", async () => {
    addCustomFont.mockResolvedValue("Brand");
    const onUploaded = vi.fn();
    render(<FontUploadButton onUploaded={onUploaded} />);

    const file = fontFile();
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("Brand"));
    expect(addCustomFont).toHaveBeenCalledWith(file);
  });

  it("does not report a family when registration fails", async () => {
    addCustomFont.mockResolvedValue(null);
    const onUploaded = vi.fn();
    render(<FontUploadButton onUploaded={onUploaded} />);

    fireEvent.change(fileInput(), { target: { files: [fontFile()] } });

    await waitFor(() => expect(addCustomFont).toHaveBeenCalled());
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("ignores a change event with no file selected", () => {
    render(<FontUploadButton onUploaded={vi.fn()} />);
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(addCustomFont).not.toHaveBeenCalled();
  });

  it("resets the input value so re-selecting the same file fires again", async () => {
    addCustomFont.mockResolvedValue("Brand");
    render(<FontUploadButton onUploaded={vi.fn()} />);
    const input = fileInput();

    fireEvent.change(input, { target: { files: [fontFile()] } });
    await waitFor(() => expect(addCustomFont).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });
});
