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
