import { getEditorState } from "./tools/getEditorState";
import { batchGet } from "./tools/batchGet";
import { snapshotLayout } from "./tools/snapshotLayout";
import { getVariables } from "./tools/getVariables";
import { getScreenshot } from "./tools/getScreenshot";

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

const stub =
  (name: string): ToolHandler =>
  async () =>
    JSON.stringify({ error: `Tool "${name}" not implemented yet` });

export const toolHandlers: Record<string, ToolHandler> = {
  get_editor_state: getEditorState,
  open_document: stub("open_document"),
  batch_get: batchGet,
  snapshot_layout: snapshotLayout,
  get_screenshot: getScreenshot,
  get_variables: getVariables,
  batch_design: stub("batch_design"),
  set_variables: stub("set_variables"),
  replace_all_matching_properties: stub("replace_all_matching_properties"),
  find_empty_space_on_canvas: stub("find_empty_space_on_canvas"),
  search_all_unique_properties: stub("search_all_unique_properties"),
  get_guidelines: stub("get_guidelines"),
  get_style_guide_tags: stub("get_style_guide_tags"),
  get_style_guide: stub("get_style_guide"),
};
