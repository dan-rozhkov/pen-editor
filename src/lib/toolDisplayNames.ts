const toolDisplayNames: Record<string, string> = {
  get_editor_state: "Get Editor State",
  open_document: "Open Document",
  batch_get: "Read Nodes",
  snapshot_layout: "Snapshot Layout",
  get_screenshot: "Get Screenshot",
  get_variables: "Get Variables",
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
};

export function getToolDisplayName(toolName: string): string {
  return toolDisplayNames[toolName] ?? toolName;
}
