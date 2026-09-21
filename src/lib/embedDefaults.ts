/**
 * A freshly created embed node starts with EMPTY html content, on purpose:
 * `EmbedLayer` renders a plain-empty embed as an on-canvas prompt composer
 * (`EmbedPromptHost`) instead of the old dummy "HTML Embed" placeholder
 * card. Seeding real (non-empty) markup here would permanently hide that
 * composer for every new embed, since `isEmbedContentEmpty` below is what
 * decides whether `EmbedLayer` shows the composer or the live HTML host.
 *
 * Used by both the embed draw tool (src/pixi/interaction/drawController.ts)
 * and the embed size-presets panel (src/components/PropertiesPanel.tsx) so
 * the two creation paths can't drift apart.
 */
export const EMPTY_EMBED_HTML = "";

/**
 * True when an embed's `htmlContent` should be treated as "not yet
 * authored" — nullish, or whitespace-only. This is the single source of
 * truth `EmbedLayer` uses to choose between the prompt composer
 * (`EmbedPromptHost`) and the live HTML host (`EmbedHost`).
 *
 * Deliberately NOT true for the old dummy-card HTML ("HTML Embed / Edit
 * HTML content in the properties panel.") that shipped before this change:
 * a document saved while that markup was the seed is real content the user
 * may have since edited or built on top of, and silently swapping it for a
 * composer would look like data loss. Only genuinely empty content counts.
 */
export function isEmbedContentEmpty(html: string | null | undefined): boolean {
  return html == null || html.trim() === "";
}
