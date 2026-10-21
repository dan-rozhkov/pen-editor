import { apiFetch } from "@/lib/apiBase";
import { DEFAULT_DOC_TITLE } from "./docStore";

export interface DocTemplate {
  id: string;
  skill: string;
  kind?: string;
  /** Short name for menus. */
  label: string;
  /** The H1 text; becomes the document title. */
  title: string;
  description: string;
  /** Body without the H1. */
  markdown: string;
}

let cached: DocTemplate[] | null = null;
let inflight: Promise<DocTemplate[] | null> | null = null;

function isTemplate(value: unknown): value is DocTemplate {
  const t = value as Partial<Record<keyof DocTemplate, unknown>> | null;
  return (
    !!t &&
    typeof t.id === "string" &&
    typeof t.label === "string" &&
    typeof t.title === "string" &&
    typeof t.markdown === "string"
  );
}

/** Templates already loaded in this page, or null (not loaded yet, or the backend is unavailable). */
export function getCachedDocTemplates(): DocTemplate[] | null {
  return cached;
}

/**
 * Loads GET /api/doc-templates once per page load. A failure resolves to null and is not
 * cached, so the next call retries. Never throws.
 */
export function loadDocTemplates(): Promise<DocTemplate[] | null> {
  if (cached) return Promise.resolve(cached);
  inflight ??= (async () => {
    try {
      const response = await apiFetch("/api/doc-templates");
      if (!response.ok) return null;
      const body = (await response.json()) as { templates?: unknown };
      if (!Array.isArray(body.templates)) return null;
      const templates = body.templates.filter(isTemplate);
      cached = templates.length > 0 ? templates : null;
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function resetDocTemplatesCache(): void {
  cached = null;
  inflight = null;
}

/** The title to set after inserting a template: only an empty or default ("Untitled") title is replaced. */
export function titleAfterTemplate(currentTitle: string, templateTitle: string): string | null {
  const current = currentTitle.trim();
  return current && current !== DEFAULT_DOC_TITLE ? null : templateTitle;
}
