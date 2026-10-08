import { beforeEach, describe, expect, it } from "vitest";
import { openDocument } from "../openDocument";
import { useDocumentStore } from "@/store/documentStore";
import { resetStores } from "@/test/fixtures";

describe("openDocument new", () => {
  beforeEach(resetStores);

  it("resets the document identity, pins and library authorship", async () => {
    useDocumentStore.setState({
      documentId: "old-doc",
      libraries: [{ id: "lib_a", name: "A", version: "1.0.0" } as never],
      libraryAuthor: { libraryId: "lib_a", name: "A" } as never,
    });
    const result = JSON.parse(await openDocument({ filePathOrTemplate: "new" }));
    expect(result.success).toBe(true);
    const doc = useDocumentStore.getState();
    expect(doc.documentId).not.toBe("old-doc");
    expect(doc.documentId).toBeTruthy();
    expect(doc.libraries).toEqual([]);
    expect(doc.libraryAuthor).toBeNull();
  });
});
