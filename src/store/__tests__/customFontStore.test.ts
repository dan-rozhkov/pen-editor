import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  notifyFontsChanged,
  getAvailableFonts,
  getAllCustomFontRecords,
  putCustomFontRecord,
  deleteCustomFontRecord,
  registerFontFace,
  unregisterFontFace,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  notifyFontsChanged: vi.fn(),
  getAvailableFonts: vi.fn(),
  getAllCustomFontRecords: vi.fn(),
  putCustomFontRecord: vi.fn(),
  deleteCustomFontRecord: vi.fn(),
  registerFontFace: vi.fn(),
  unregisterFontFace: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/utils/fontUtils", () => ({ notifyFontsChanged, getAvailableFonts }));
vi.mock("@/utils/customFontDb", () => ({
  getAllCustomFontRecords,
  putCustomFontRecord,
  deleteCustomFontRecord,
}));
vi.mock("@/utils/customFontRegistration", () => ({ registerFontFace, unregisterFontFace }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}));

import { useCustomFontStore } from "@/store/customFontStore";

function makeFile(name: string, size = 1024): File {
  const file = new File(["font-bytes"], name);
  Object.defineProperty(file, "size", { value: size });
  file.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(size));
  return file;
}

beforeEach(() => {
  useCustomFontStore.setState({ customFonts: [], hydrated: false });
  vi.clearAllMocks();
  getAvailableFonts.mockResolvedValue([{ family: "Arial", isSystemFont: true }]);
  getAllCustomFontRecords.mockResolvedValue([]);
  putCustomFontRecord.mockResolvedValue(undefined);
  deleteCustomFontRecord.mockResolvedValue(undefined);
  registerFontFace.mockResolvedValue(undefined);
});

describe("customFontStore.addCustomFont", () => {
  it("registers, persists, and adds a valid font to state", async () => {
    const file = makeFile("Brand Sans.ttf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBe("Brand Sans");
    expect(registerFontFace).toHaveBeenCalledWith("Brand Sans", expect.any(ArrayBuffer));
    expect(putCustomFontRecord).toHaveBeenCalledWith(
      expect.objectContaining({ family: "Brand Sans", fileName: "Brand Sans.ttf", format: "ttf" }),
    );
    expect(useCustomFontStore.getState().customFonts).toEqual([
      { family: "Brand Sans", fileName: "Brand Sans.ttf", format: "ttf" },
    ]);
    expect(notifyFontsChanged).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("rejects an unsupported file extension without touching storage", async () => {
    const file = makeFile("Brand.pdf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBeNull();
    expect(registerFontFace).not.toHaveBeenCalled();
    expect(putCustomFontRecord).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(useCustomFontStore.getState().customFonts).toEqual([]);
  });

  it("rejects a duplicate family name", async () => {
    useCustomFontStore.setState({
      customFonts: [{ family: "Brand Sans", fileName: "a.ttf", format: "ttf" }],
    });
    const file = makeFile("Brand Sans.ttf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBeNull();
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/already uploaded/i));
  });

  it("shows an error toast and does not change state when the font fails to parse (corrupt file)", async () => {
    registerFontFace.mockRejectedValueOnce(new Error("parse error"));
    const file = makeFile("Brand.ttf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBeNull();
    expect(putCustomFontRecord).not.toHaveBeenCalled();
    expect(useCustomFontStore.getState().customFonts).toEqual([]);
    expect(toastError).toHaveBeenCalled();
  });

  it("rejects a font whose name collides with a built-in/system font", async () => {
    const file = makeFile("Arial.ttf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBeNull();
    expect(registerFontFace).not.toHaveBeenCalled();
    expect(putCustomFontRecord).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/built-in font/i));
  });

  it("rolls back the registered FontFace when persistence fails", async () => {
    putCustomFontRecord.mockRejectedValueOnce(new Error("QuotaExceeded"));
    const file = makeFile("Brand.ttf");

    const family = await useCustomFontStore.getState().addCustomFont(file);

    expect(family).toBeNull();
    expect(registerFontFace).toHaveBeenCalledWith("Brand", expect.any(ArrayBuffer));
    // The FontFace was added but couldn't be persisted — it must be removed,
    // not left as a session-only font the user was told failed.
    expect(unregisterFontFace).toHaveBeenCalledWith("Brand");
    expect(useCustomFontStore.getState().customFonts).toEqual([]);
    expect(toastError).toHaveBeenCalled();
  });
});

describe("customFontStore.removeCustomFont", () => {
  it("unregisters, deletes from storage, and updates state", async () => {
    useCustomFontStore.setState({
      customFonts: [{ family: "Brand Sans", fileName: "a.ttf", format: "ttf" }],
    });

    await useCustomFontStore.getState().removeCustomFont("Brand Sans");

    expect(unregisterFontFace).toHaveBeenCalledWith("Brand Sans");
    expect(deleteCustomFontRecord).toHaveBeenCalledWith("Brand Sans");
    expect(useCustomFontStore.getState().customFonts).toEqual([]);
    expect(notifyFontsChanged).toHaveBeenCalled();
  });

  it("keeps the font when storage deletion fails (so it doesn't resurrect on reload)", async () => {
    useCustomFontStore.setState({
      customFonts: [{ family: "Brand Sans", fileName: "a.ttf", format: "ttf" }],
    });
    deleteCustomFontRecord.mockRejectedValueOnce(new Error("IDB down"));

    await useCustomFontStore.getState().removeCustomFont("Brand Sans");

    expect(unregisterFontFace).not.toHaveBeenCalled();
    expect(useCustomFontStore.getState().customFonts).toEqual([
      { family: "Brand Sans", fileName: "a.ttf", format: "ttf" },
    ]);
    expect(toastError).toHaveBeenCalled();
  });
});

describe("customFontStore.restoreCustomFonts", () => {
  it("re-registers every stored record and populates state", async () => {
    getAllCustomFontRecords.mockResolvedValue([
      { family: "Brand Sans", fileName: "a.ttf", format: "ttf", bytes: new ArrayBuffer(4) },
      { family: "Brand Serif", fileName: "b.otf", format: "otf", bytes: new ArrayBuffer(4) },
    ]);

    await useCustomFontStore.getState().restoreCustomFonts();

    expect(registerFontFace).toHaveBeenCalledTimes(2);
    expect(useCustomFontStore.getState().customFonts).toEqual([
      { family: "Brand Sans", fileName: "a.ttf", format: "ttf" },
      { family: "Brand Serif", fileName: "b.otf", format: "otf" },
    ]);
    expect(useCustomFontStore.getState().hydrated).toBe(true);
    expect(notifyFontsChanged).toHaveBeenCalled();
  });

  it("skips a record that fails to re-register instead of throwing", async () => {
    getAllCustomFontRecords.mockResolvedValue([
      { family: "Good", fileName: "a.ttf", format: "ttf", bytes: new ArrayBuffer(4) },
      { family: "Bad", fileName: "b.ttf", format: "ttf", bytes: new ArrayBuffer(4) },
    ]);
    registerFontFace.mockImplementation((family: string) =>
      family === "Bad" ? Promise.reject(new Error("corrupt")) : Promise.resolve(),
    );

    await expect(useCustomFontStore.getState().restoreCustomFonts()).resolves.toBeUndefined();

    expect(useCustomFontStore.getState().customFonts).toEqual([
      { family: "Good", fileName: "a.ttf", format: "ttf" },
    ]);
  });
});
