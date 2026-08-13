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
  search_screens: "Search Screens",
  get_screen: "Get Screen",
  search_flows: "Search Flows",
  get_flow: "Get Flow",
  get_design_guidance: "Design Guidance",
  refero_search_screens: "Search Screens",
  refero_get_screen: "Get Screen",
  refero_search_flows: "Search Flows",
  refero_get_flow: "Get Flow",
  mcp_refero_search_screens: "Search Screens",
  mcp_refero_get_screen: "Get Screen",
  mcp_refero_search_flows: "Search Flows",
  mcp_refero_get_flow: "Get Flow",
  mcp_refero_get_design_guidance: "Design Guidance",
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
