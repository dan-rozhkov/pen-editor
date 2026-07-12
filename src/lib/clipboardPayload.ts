// Shared helpers for decoding the base64-wrapped clipboard payloads written
// by Figma's own clipboard buffer (`figmaPaste`) and by the html.to.design /
// Figma-capture extension (`h2dPaste`). Both wrap their data in
// `<!--(marker)BASE64(/marker)-->` comment-style markers inside a `text/html`
// clipboard item.

/**
 * Extract the base64 payload between a `start`/`end` marker pair in a
 * clipboard `text/html` string. Returns null if either marker is absent.
 */
export function extractBase64Section(html: string, start: string, end: string): string | null {
  const startIndex = html.indexOf(start)
  if (startIndex === -1) return null
  const endIndex = html.indexOf(end, startIndex + start.length)
  if (endIndex === -1) return null
  // The base64 payload may contain whitespace/newlines inserted by the clipboard
  return html.slice(startIndex + start.length, endIndex).replace(/\s+/g, '')
}

/** Decode a base64 string into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
