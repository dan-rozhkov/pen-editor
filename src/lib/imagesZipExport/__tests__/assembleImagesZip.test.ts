import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { assembleImagesZip } from "../assembleImagesZip";

describe("assembleImagesZip", () => {
  it("throws on zero files", () => {
    expect(() => assembleImagesZip([])).toThrow();
  });

  it("round-trips file names and bytes through unzipSync", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const bytes = assembleImagesZip([
      { name: "Frame 1.png", bytes: a },
      { name: "Frame 2.png", bytes: b },
    ]);

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["Frame 1.png", "Frame 2.png"]);
    expect(files["Frame 1.png"]).toEqual(a);
    expect(files["Frame 2.png"]).toEqual(b);
  });

  it("dedupes duplicate names with a numeric suffix, keeping every file", () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const c = new Uint8Array([3]);
    const bytes = assembleImagesZip([
      { name: "Slide 1.png", bytes: a },
      { name: "Slide 1.png", bytes: b },
      { name: "Slide 1.png", bytes: c },
    ]);

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["Slide 1-2.png", "Slide 1-3.png", "Slide 1.png"]);
    expect(files["Slide 1.png"]).toEqual(a);
    expect(files["Slide 1-2.png"]).toEqual(b);
    expect(files["Slide 1-3.png"]).toEqual(c);
  });

  it("only dedupes names that actually collide", () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const bytes = assembleImagesZip([
      { name: "A.png", bytes: a },
      { name: "B.png", bytes: b },
    ]);

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["A.png", "B.png"]);
  });

  it("produces well-formed zip content readable via strFromU8 for text-like bytes", () => {
    const bytes = assembleImagesZip([{ name: "note.txt", bytes: new TextEncoder().encode("hello") }]);
    const files = unzipSync(bytes);
    expect(strFromU8(files["note.txt"])).toBe("hello");
  });
});
