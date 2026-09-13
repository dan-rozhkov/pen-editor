// Apps arrive already grouped from the backend (GET /api/showcase paginates
// by app), so the client-side `groupScreensByApp` that the masonry-era flat
// screen feed needed is gone. What's left is presentation.

/** Turns provider model ids into friendly labels. Published apps carry
 * whatever model generated them — including models the editor never ran on —
 * so the id itself is the only thing to work from. */
export function getShowcaseModelLabel(model: string): string {
  const modelName = model.split("/").at(-1) || model;
  return modelName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
