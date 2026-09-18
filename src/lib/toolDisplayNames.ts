// Mobbin (MCP), keyed by the bare tool name. Mobbin's whole surface is these
// three search tools — no per-item fetch, no flow detail, no style search, no
// guidance tool, unlike the Refero MCP this replaced — so the labels just say
// what's being searched; the Mobbin mark in `toolIcons` already says where
// the results come from, so the label doesn't repeat it.
const mobbinLabels: Record<string, string> = {
  search_screens: "Searching screens",
  search_flows: "Searching flows",
  search_sections: "Searching sections",
};

// The same tool reaches this UI under up to three spellings: bare (the older
// naming still used in the backend's research skill), `mobbin_`-prefixed (what
// the MCP server advertises today) and `mcp_mobbin_`-prefixed. All three must
// render identically, so they are generated rather than hand-listed — a
// hand-written table is exactly how the bare aliases previously ended up with
// a different label and a different icon from their prefixed twins (the
// Refero tool set this replaced hit exactly this bug once).
export const mobbinToolDisplayNames: Record<string, string> = Object.fromEntries(
  Object.entries(mobbinLabels).flatMap(([name, label]) =>
    ["", "mobbin_", "mcp_mobbin_"].map((prefix) => [`${prefix}${name}`, label]),
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
  apply_text_style: "Apply Text Style",
  get_styles: "Get Styles",
  set_styles: "Set Styles",
  apply_fill_style: "Apply Fill Style",
  apply_effect_style: "Apply Effect Style",
  batch_design: "Design",
  draw_vector: "Draw Vector",
  rename_layers: "Rename Layers",
  read_embed_html: "Explore Design",
  edit_embed_html: "Make Changes to Design",
  boolean_operation: "Boolean Operation",
  set_variables: "Set Variables",
  set_export_settings: "Set Export Settings",
  export_layers_svg: "Export Layers as SVG",
  replace_all_matching_properties: "Replace Properties",
  find_empty_space_on_canvas: "Find Empty Space",
  search_all_unique_properties: "Search Properties",
  get_guidelines: "Get Guidelines",
  get_style_guide_tags: "Get Style Guide Tags",
  get_style_guide: "Get Style Guide",
  update_tasks: "Update tasks",
  read_comments: "Read Comments",
  reply_comment: "Reply to Comment",
  resolve_comment: "Resolve Comment",
  leave_comment: "Leave Comment",
  create_plugin: "Create Plugin",
  update_plugin: "Update Plugin",
  list_plugins: "List Plugins",
  generate_image: "Generate Image",
  generate_frame_image: "Generate Frame Image",
  remove_background: "Remove Background",
  vectorize_image: "Vectorize Image",
  analyze_image: "Analyze Image",
  publish_to_showcase: "Publish to Showcase",
  read_design_repo: "Read Design Repo",
  read_repo_files: "Read Repo Files",
  attach_local_repo: "Attach Local Repo",
  browse_open: "Open Browser",
  browse_act: "Browse",
  browse_find_images: "Find Images in Browser",
  browse_read: "Read Page",
  browse_task: "Browse Task",
  web_search: "Search the Web",
  fetch_url: "Read Web Pages",
  ...mobbinToolDisplayNames,
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
