import { shareCurrentCanvas } from "@/lib/shareCanvas";

// The widget's own origin is a host sandbox, so the public link is built from
// where this bundle was served (app.sideform.pro), never window.location.
export function embedAppBase(moduleUrl: string = import.meta.url): string {
  const base = import.meta.env.BASE_URL || "/";
  try {
    return new URL(base, moduleUrl).href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export type OpenInSideformResult = { ok: true; url: string } | { ok: false; error: string };

export async function openInSideform(
  openLink: (url: string) => Promise<boolean>,
  appBase: string = embedAppBase(),
): Promise<OpenInSideformResult> {
  const shared = await shareCurrentCanvas();
  if (!shared.ok) return { ok: false, error: shared.error };
  const url = `${appBase}/c/${shared.id}`;
  if (!(await openLink(url))) return { ok: false, error: "The host did not open the link." };
  return { ok: true, url };
}
