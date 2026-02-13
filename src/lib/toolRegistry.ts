export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

const stub =
  (name: string): ToolHandler =>
  async () =>
    JSON.stringify({ error: `Tool "${name}" not implemented yet` });

export const toolHandlers: Record<string, ToolHandler> = {
  get_editor_state: stub("get_editor_state"),
  open_document: stub("open_document"),
  batch_get: stub("batch_get"),
  snapshot_layout: stub("snapshot_layout"),
  get_screenshot: stub("get_screenshot"),
  get_variables: stub("get_variables"),
  batch_design: stub("batch_design"),
  set_variables: stub("set_variables"),
  replace_all_matching_properties: stub("replace_all_matching_properties"),
  find_empty_space_on_canvas: stub("find_empty_space_on_canvas"),
  search_all_unique_properties: stub("search_all_unique_properties"),
  get_guidelines: stub("get_guidelines"),
  get_style_guide_tags: stub("get_style_guide_tags"),
  get_style_guide: stub("get_style_guide"),
};
