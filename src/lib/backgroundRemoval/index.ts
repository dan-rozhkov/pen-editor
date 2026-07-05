export { removeBackground } from "./removeBackground";
export { REMOVE_BG_INPUT_SIZE, REMOVE_BG_MODEL_URL } from "./constants";

/** Read a `Blob` into a `data:` URI, the same representation manual image
 * uploads use for `ImageFill.url` (see `ImageFillEditor`). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read result image"));
    reader.readAsDataURL(blob);
  });
}
