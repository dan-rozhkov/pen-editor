import type { LeftSection } from "@/store/leftSidebarStore";

// Rail sections hidden while viewing someone else's shared canvas
// (`/c/:shareId`). "agents" is the important one: the AI chat's tool
// handlers (src/lib/tools/) mutate the scene stores directly, *below*
// `canEditScene` — read-only `view` mode never gates them — so removing the
// way to open the chat (and therefore invoke a tool) is the actual
// enforcement of "view only" here, not a UI nicety. "toolbox" (plugins) and
// "comments" (a discussion surface tied to an editable document) are hidden
// for the same "this isn't your document" reason.
export const HIDDEN_IN_SHARED_VIEW = new Set<LeftSection>(["agents", "toolbox", "comments"]);

/**
 * The section to actually render, given the persisted user preference and
 * whether this tab is a shared-canvas viewer. Deliberately a pure
 * derivation, NOT a store mutation: a shared link is a one-off detour
 * through someone else's document, not a change to the visitor's own
 * editor preference, so this must never call `leftSidebarStore`'s
 * `setActiveSection` (which persists to localStorage) — doing so used to
 * permanently switch which section every subsequent editor session opened
 * to, just from having opened a share link once.
 *
 * Shared by LeftRail.tsx (which rail icon shows as active) and
 * LeftSidebar.tsx (which panel actually mounts), so the two can never
 * disagree about what a shared-view visitor is allowed to see.
 */
export function resolveVisibleLeftSection(
  activeSection: LeftSection,
  isSharedView: boolean,
): LeftSection {
  return isSharedView && HIDDEN_IN_SHARED_VIEW.has(activeSection) ? "pages" : activeSection;
}
