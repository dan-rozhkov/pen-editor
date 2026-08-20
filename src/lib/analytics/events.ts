/**
 * Typed catalog of every analytics event this app can emit. Event names are
 * snake_case. Adding a new event MUST go through this map — `track()` is
 * typed against it, so an untyped event name is a compile error.
 *
 * NO PII: property values here must stay enums, booleans, counts, or
 * bucketed numbers. Never prompt text, document content, file names, node
 * text, or user-typed strings — see src/lib/analytics/index.ts's module
 * doc for the full rule.
 */
export interface AnalyticsEventMap {
  // --- Showcase (types only — instrumented by a different agent) ---
  showcase_viewed: { platform?: string; category?: string; sort?: string };
  showcase_app_opened: {
    app_id: string;
    platform?: string;
    category?: string;
    feed_position: number;
  };
  showcase_screen_viewed: { app_id: string; screen_index: number };
  showcase_liked: { app_id: string };
  showcase_filter_applied: {
    filter: "platform" | "category" | "sort" | "model";
    value: string;
  };
  showcase_feed_paginated: { page: number; apps_loaded: number };
  showcase_editor_cta_clicked: {
    app_id?: string;
    // "lightbox" currently has no live call site — ShowcaseLightbox.tsx is
    // unmounted/unused — but is kept in the union for whenever it returns,
    // rather than removed and re-added later.
    source: "card" | "carousel" | "lightbox" | "header";
  };

  // --- Editor ---
  editor_opened: { is_first_session: boolean; via_showcase_handoff: boolean };
  first_prompt_sent: { ms_since_open: number };
  chat_message_sent: {
    has_attachment: boolean;
    is_slash_command: boolean;
    length_bucket: string;
  };
  agent_tool_executed: {
    tool_name: string;
    ok: boolean;
    duration_ms: number;
    error_kind?: string;
    source: "chat" | "bridge";
  };
  agent_turn_failed: { error_kind: string };
  editor_command_run: { command_id: string };
  document_exported: { format: string };
  showcase_publish_clicked: { screen_count?: number };

  // --- Canvas sharing ---
  canvas_shared: Record<string, never>;
  canvas_unshared: Record<string, never>;
  shared_canvas_viewed: { share_id: string };
  shared_canvas_forked: { share_id: string };
}
