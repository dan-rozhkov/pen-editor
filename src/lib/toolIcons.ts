import {
  BookOpenIcon,
  BoundingBoxIcon,
  BrainIcon,
  CameraIcon,
  CrosshairIcon,
  type Icon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PencilSimpleIcon,
  RulerIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  SwapIcon,
  SwatchesIcon,
  TagIcon,
  TextAaIcon,
  QuestionIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ReferoIcon } from "@/components/icons/ReferoIcon";
import { referoToolDisplayNames } from "@/lib/toolDisplayNames";

// Icon per tool, shown before the label in ToolCallIndicator. Keys mirror
// `toolDisplayNames` — `toolIcons.test.ts` fails if the two drift, so a new
// tool gets both a name and an icon or neither.
const toolIcons: Record<string, Icon> = {
  get_editor_state: SquaresFourIcon,
  batch_get: BoundingBoxIcon,
  snapshot_layout: RulerIcon,
  get_screenshot: CameraIcon,
  get_variables: SwatchesIcon,
  get_text_styles: TextAaIcon,
  set_text_styles: TextAaIcon,
  batch_design: PencilSimpleIcon,
  set_variables: SlidersHorizontalIcon,
  replace_all_matching_properties: SwapIcon,
  find_empty_space_on_canvas: CrosshairIcon,
  search_all_unique_properties: MagnifyingGlassIcon,
  get_guidelines: BookOpenIcon,
  get_style_guide_tags: TagIcon,
  get_style_guide: PaletteIcon,
  // Every Refero-served tool carries the Refero mark instead of a
  // task-specific glyph: in a long turn the useful thing to spot at a glance
  // is that the agent went out to the reference library at all. The labels
  // (`toolDisplayNames`) are what tell the calls apart from one another.
  // Derived from the same generated key set as the labels, so every spelling
  // of a Refero tool is branded and none can be forgotten here.
  ...Object.fromEntries(
    Object.keys(referoToolDisplayNames).map((name) => [name, ReferoIcon]),
  ),
  ask_user: QuestionIcon,
  load_skill: BookOpenIcon,
  memory: BrainIcon,
  skill_manage: BookOpenIcon,
};

/** Falls back to a generic tool icon for anything unmapped. */
export function getToolIcon(toolName: string): Icon {
  return toolIcons[toolName] ?? WrenchIcon;
}
