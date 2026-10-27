import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { decideImageOpen, IMAGE_DOWNLOAD_FAILED_MESSAGE, imageFilename, openDocImage } from "../openDocImage";

const origin = "https://app.test";

describe("decideImageOpen", () => {
  it("opens a cross-origin http(s) image", () => {
    expect(decideImageOpen("https://cdn.test/a.png", origin)).toEqual({ kind: "open", url: "https://cdn.test/a.png" });
    expect(decideImageOpen("http://cdn.test/a.png", origin)).toEqual({ kind: "open", url: "http://cdn.test/a.png" });
  });
  it.each([
    ["/img/a.png", "https://app.test/img/a.png"],
    ["https://app.test/a.svg", "https://app.test/a.svg"],
    ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    ["data:text/html,<script>x</script>", "data:text/html,<script>x</script>"],
    ["blob:https://app.test/1234", "blob:https://app.test/1234"],
  ])("downloads %s, never opens it on the editor's origin", (src, url) => {
    expect(decideImageOpen(src, origin)).toEqual({ kind: "download", url });
  });
  it.each(["javascript:alert(1)", "file:///a.png", "", "   ", "http://"])("ignores %j", (src) => {
    expect(decideImageOpen(src, origin)).toEqual({ kind: "none" });
  });
});

describe("imageFilename", () => {
  it.each([
    ["https://cdn.test/x/a%20b.png", undefined, "a b.png"],
    ["https://cdn.test/api/image?id=1", "image/webp", "image.webp"],
    ["https://cdn.test/img/view.php", "image/png", "image.png"],
    ["data:image/jpeg;base64,AAAA", "image/jpeg", "image.jpg"],
    ["blob:https://app.test/1234", "image/gif", "image.gif"],
  ])("%s -> %s", (url, type, name) => {
    expect(imageFilename(url, type)).toBe(name);
  });
});

describe("openDocImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens a cross-origin image in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openDocImage("https://cdn.test/a.png");
    expect(open).toHaveBeenCalledWith("https://cdn.test/a.png", "_blank", "noopener,noreferrer");
  });

  it.each([
    ["a same-origin image", "/x/a.png", "image/png", "a.png"],
    ["a same-origin image with no extension", "/api/img?id=1", "image/webp", "image.webp"],
    ["an SVG data: image with a bare %", "data:image/svg+xml;utf8,<svg width='100%'/>", "image/svg+xml", "image.svg"],
  ])("downloads %s and never opens it", async (_name, src, type, filename) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type }))));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:made");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await openDocImage(src);
    expect(names).toEqual([filename]);
    expect(open).not.toHaveBeenCalled();
  });

  it("tells the user when the download fails and saves nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await openDocImage("/x/a.png");
    expect(error).toHaveBeenCalledWith(IMAGE_DOWNLOAD_FAILED_MESSAGE);
    expect(click).not.toHaveBeenCalled();
  });

  it("does nothing for an unsafe src and never throws", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await openDocImage("javascript:alert(1)");
    expect(open).not.toHaveBeenCalled();
    await expect(openDocImage("https://cdn.test/a.png")).resolves.toBeUndefined();
  });
});
