// Refero (MCP), keyed by the bare tool name. The labels say what the tool does
// to a *reference* — Refero's own vocabulary for the screens, flows and styles
// it indexes — rather than echoing the raw tool name; the Refero mark in
// `toolIcons` already says where the data comes from, so the label doesn't
// repeat it.
const referoLabels: Record<string, string> = {
  search_screens: "Search Reference Screens",
  get_screen: "Open Reference Screen",
  get_screen_image: "Reference Screenshot",
  get_similar_screens: "Find Similar Screens",
  search_flows: "Search Reference Flows",
  get_flow: "Open Reference Flow",
  search_styles: "Search Design Styles",
  get_style: "Open Design Style",
  get_design_guidance: "Design Guidance",
};

// The same tool reaches this UI under up to three spellings: bare (the older
// naming still used in the backend's research skill), `refero_`-prefixed (what
// the MCP server advertises today) and `mcp_refero_`-prefixed. All three must
// render identically, so they are generated rather than hand-listed — a
// hand-written table is exactly how the bare aliases previously ended up with
// a different label and a different icon from their prefixed twins.
export const referoToolDisplayNames: Record<string, string> = Object.fromEntries(
  Object.entries(referoLabels).flatMap(([name, label]) =>
    ["", "refero_", "mcp_refero_"].map((prefix) => [`${prefix}${name}`, label]),
  ),
);

export const toolDisplayNames: Record<string, string> = {
  get_editor_state: "Get Editor State",
  batch_get: "Read Nodes",
  snapshot_layout: "Snapshot Layout",
  get_screenshot: "Get Screenshot",
  get_variables: "Get Variables",
  get_text_styles: "Get Text Styles",
  set_text_styles: "Set Text Styles",
  batch_design: "Design",
  set_variables: "Set Variables",
  replace_all_matching_properties: "Replace Properties",
  find_empty_space_on_canvas: "Find Empty Space",
  search_all_unique_properties: "Search Properties",
  get_guidelines: "Get Guidelines",
  get_style_guide_tags: "Get Style Guide Tags",
  get_style_guide: "Get Style Guide",
  ...referoToolDisplayNames,
  ask_user: "Ask a question",
  load_skill: "Load skill",
  memory: "Memory",
  // "Manage skill" (sentence case, matching "Load skill"/"Ask a question"
  // above) — this used to read "Manage Skill" (Title Case), inconsistent
  // with every other entry here. Visible whenever an unsuccessful
  // skill_manage call falls back to the plain ToolCallIndicator.
  skill_manage: "Manage skill",
  // No `skill_view` entry: that tool is only ever offered to the
  // background-review LLM call (review.ts, includeView: true) — a separate,
  // fire-and-forget generateText run whose tool calls are never part of the
  // SSE stream the chat panel renders. chatTurn.ts's foreground turn (the
  // one that actually reaches this UI) always passes includeView: false, so
  // "tool-skill_view" can never appear in a message part here. A display
  // name for it would be dead code; getToolDisplayName's fallback to the
  // raw tool name already covers any future/unexpected tool safely.
};

export function getToolDisplayName(toolName: string): string {
  return toolDisplayNames[toolName] ?? toolName;
}
