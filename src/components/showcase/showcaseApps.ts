import { getModelOptions } from "@/lib/chatModels";
import type { ShowcaseScreen } from "@/lib/showcase";

export interface ShowcaseApp {
  runId: string;
  screens: ShowcaseScreen[];
}

/** Preserve feed order while collecting every screen generated in one run. */
export function groupScreensByApp(screens: ShowcaseScreen[]): ShowcaseApp[] {
  const apps = new Map<string, ShowcaseApp>();

  for (const screen of screens) {
    const app = apps.get(screen.runId);
    if (app) {
      app.screens.push(screen);
    } else {
      apps.set(screen.runId, { runId: screen.runId, screens: [screen] });
    }
  }

  return [...apps.values()];
}

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
