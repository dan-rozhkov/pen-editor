/**
 * Single source of truth for the MCP tool-name subsets that must stay in
 * sync across the desktop bridge and its contract tests. Previously these
 * were three hand-copied lists (desktopMcpBridge.ts's `MCP_TOOL_NAMES`,
 * toolContract.test.ts's `EXPECTED_BRIDGED_MCP_TOOLS`/`BACKEND_EXECUTED_TOOLS`,
 * and a third pinned inline in desktopMcpBridge.test.ts) with nothing
 * enforcing agreement — a new bridged tool could pass every suite while
 * staying silently unavailable over the desktop bridge. Import from here
 * instead of re-typing the names.
 */

// The 7 tools bridged from pen-editor-backend/src/mcp/server.ts
// (BRIDGED_TOOL_NAMES). This one still has to be hand-copied across the repo
// boundary — pen-editor-backend/test/mcp-tools-contract.test.ts pins the same
// list on the backend side — but every consumer *inside this repo* must
// import this array rather than hand-copy it again.
export const BRIDGED_MCP_TOOL_NAMES = [
  "get_editor_state",
  "batch_get",
  "snapshot_layout",
  "get_variables",
  "get_screenshot",
  "batch_design",
  "set_variables",
] as const;

// The 3 client-side static guideline tools (src/lib/tools/staticTools.ts).
// These also happen to be the only backend `penTools` entries with a server
// `execute` (toolContract.test.ts's BACKEND_EXECUTED_TOOLS) — a coincidence
// of scope (both are "the 3 static guideline tools"), not of meaning, so
// that list stays separate but toolContract.test.ts asserts the two agree.
export const STATIC_MCP_TOOL_NAMES = [
  "get_guidelines",
  "get_style_guide_tags",
  "get_style_guide",
] as const;

// The full MCP tool-name subset of toolHandlers advertised to the desktop
// shell: the 7 backend-bridged tools plus the 3 static ones.
export const DESKTOP_MCP_TOOL_NAMES = [
  ...BRIDGED_MCP_TOOL_NAMES,
  ...STATIC_MCP_TOOL_NAMES,
];
