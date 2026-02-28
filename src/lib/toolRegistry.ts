import { getEditorState } from "./tools/getEditorState";
import { batchGet } from "./tools/batchGet";
import { batchDesign } from "./tools/batchDesign";
import { snapshotLayout } from "./tools/snapshotLayout";
import { getVariables } from "./tools/getVariables";
import { getScreenshot } from "./tools/getScreenshot";
import { setVariables } from "./tools/setVariables";
import { replaceAllMatchingProperties } from "./tools/replaceAllMatchingProperties";
import { searchAllUniqueProperties } from "./tools/searchAllUniqueProperties";
import { findEmptySpace } from "./tools/findEmptySpace";
import { openDocument } from "./tools/openDocument";
import { getGuidelines, getStyleGuide, getStyleGuideTags } from "./tools/staticTools";
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

export const toolHandlers: Record<string, ToolHandler> = {
  get_editor_state: getEditorState,
  open_document: openDocument,
  batch_get: batchGet,
  snapshot_layout: snapshotLayout,
  get_screenshot: getScreenshot,
  get_variables: getVariables,
  batch_design: batchDesign,
  set_variables: setVariables,
  replace_all_matching_properties: replaceAllMatchingProperties,
  find_empty_space_on_canvas: findEmptySpace,
  search_all_unique_properties: searchAllUniqueProperties,
  get_guidelines: getGuidelines,
  get_style_guide_tags: getStyleGuideTags,
  get_style_guide: getStyleGuide,
};
