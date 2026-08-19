// Every URL `generate_image`/`generate_frame_image` actually returned during
// this session, so `batch_design` can repair a mistyped copy of one of them
// found inside embed HTML (see repairImageUrls.ts). Module-level rather than
// stored in a Zustand store: it's write-only bookkeeping for a same-tab
// session, not UI state, and doesn't need to survive a reload.
const issuedImageUrls: string[] = [];

// A long editing session can rack up generations, and every issued URL is a
// candidate the repair pass measures each suspect URL against. Keeping the
// most recent 100 bounds that work without ever dropping a URL the model
// could still be transcribing — it writes the HTML within a turn or two of
// generating the image.
const MAX_ISSUED_URLS = 100;

// `data:` urls are never transcription targets — the model is told not to
// paste them into HTML at all (see generateImage/index.ts's `note` field),
// so there is nothing for the repair pass to snap a typo back to.
export function recordIssuedImageUrl(url: string): void {
  if (url.startsWith("data:")) return;
  issuedImageUrls.push(url);
  if (issuedImageUrls.length > MAX_ISSUED_URLS) {
    issuedImageUrls.splice(0, issuedImageUrls.length - MAX_ISSUED_URLS);
  }
}

export function getIssuedImageUrls(): string[] {
  return issuedImageUrls;
}

// Exported for tests only — keeps each test's registry state isolated.
export function resetIssuedImageUrls(): void {
  issuedImageUrls.length = 0;
}
