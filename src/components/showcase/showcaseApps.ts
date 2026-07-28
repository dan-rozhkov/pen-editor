import { getModelOptions } from "@/lib/chatModels";

// Apps arrive already grouped from the backend (GET /api/showcase paginates
// by app), so the client-side `groupScreensByApp` that the masonry-era flat
// screen feed needed is gone. What's left is presentation.

/** Turns provider model ids into the friendly labels used by the editor. */
export function getShowcaseModelLabel(model: string): string {
  const knownModel = getModelOptions().find((option) => option.value === model);
  if (knownModel) return knownModel.label;

  const modelName = model.split("/").at(-1) || model;
  return modelName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
