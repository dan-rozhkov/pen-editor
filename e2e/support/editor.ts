import { expect, type Page } from "@playwright/test";

// The editor lives behind "/app" as a lazy route chunk (the showcase owns
// "/"), so the first spec to open it waits for the dev server to transform and
// serve App + PixiJS. On CI that cold start regularly runs past Playwright's
// 5s expect default: the e2e job went red on main with `[data-canvas]`
// "element(s) not found", while a retry that hit a warm server took 27s and
// passed. Wait for the canvas through here so every spec gets a timeout sized
// for that first load instead of the default.
export const EDITOR_MOUNT_TIMEOUT = 60_000;

export async function expectEditorMounted(page: Page) {
  await expect(page.locator("[data-canvas]")).toBeVisible({
    timeout: EDITOR_MOUNT_TIMEOUT,
  });
}
