const FALLBACK_NAME = "Untitled";
const MAX_NAME_LENGTH = 100;

/** `<title>.md` with characters that file systems reject removed. */
export function docFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  // Leading dots would hide the file; trailing dots/spaces are rejected on Windows.
  const name = cleaned.replace(/^\.+/, "").slice(0, MAX_NAME_LENGTH).replace(/[. ]+$/, "").trim();
  return `${name || FALLBACK_NAME}.md`;
}

/** `<title>.pdf`, same sanitising as `docFilename`. */
export function docPdfFilename(title: string): string {
  return docFilename(title).replace(/\.md$/, ".pdf");
}

/** File text: the title as an H1, then the body. */
export function docMarkdownFile(title: string, body: string): string {
  const heading = title.trim() || FALLBACK_NAME;
  const text = body.replace(/^\s*\n/, "").trimEnd();
  return text ? `# ${heading}\n\n${text}\n` : `# ${heading}\n`;
}
