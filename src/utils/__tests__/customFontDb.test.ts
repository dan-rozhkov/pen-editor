import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteCustomFontRecord,
  getAllCustomFontRecords,
  putCustomFontRecord,
} from "@/utils/customFontDb";

function makeBuffer(byte: number, length = 4): ArrayBuffer {
  const buf = new ArrayBuffer(length);
  new Uint8Array(buf).fill(byte);
  return buf;
}

beforeEach(async () => {
  const records = await getAllCustomFontRecords();
  await Promise.all(records.map((r) => deleteCustomFontRecord(r.family)));
});

describe("customFontDb", () => {
  it("starts empty", async () => {
    expect(await getAllCustomFontRecords()).toEqual([]);
  });

  it("round-trips a stored font record", async () => {
    await putCustomFontRecord({
      family: "Brand Sans",
      fileName: "Brand.ttf",
      format: "ttf",
      bytes: makeBuffer(1),
    });

    const records = await getAllCustomFontRecords();
    expect(records).toHaveLength(1);
    expect(records[0].family).toBe("Brand Sans");
    expect(records[0].fileName).toBe("Brand.ttf");
    expect(records[0].format).toBe("ttf");
    expect(new Uint8Array(records[0].bytes)).toEqual(new Uint8Array(makeBuffer(1)));
  });

  it("overwrites the record for a family that's re-uploaded (keyPath dedup)", async () => {
    await putCustomFontRecord({ family: "Brand Sans", fileName: "v1.ttf", format: "ttf", bytes: makeBuffer(1) });
    await putCustomFontRecord({ family: "Brand Sans", fileName: "v2.ttf", format: "ttf", bytes: makeBuffer(2) });

    const records = await getAllCustomFontRecords();
    expect(records).toHaveLength(1);
    expect(records[0].fileName).toBe("v2.ttf");
  });

  it("deletes a record by family", async () => {
    await putCustomFontRecord({ family: "Brand Sans", fileName: "Brand.ttf", format: "ttf", bytes: makeBuffer(1) });
    await deleteCustomFontRecord("Brand Sans");
    expect(await getAllCustomFontRecords()).toEqual([]);
  });
});
