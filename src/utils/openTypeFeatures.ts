/**
 * OpenType feature control for text nodes (discretionary ligatures,
 * small caps, numeral styles, fractions, slashed zero) —
 * the sibling feature to `variableFont.ts`'s variable-font axes. A node's
 * `fontFeatures?: Record<string, number>` (see `types/scene.ts`) maps
 * straight onto CSS `font-feature-settings`, e.g. `{ dlig: 1, tnum: 1 }` ->
 * `"dlig" 1, "tnum" 1"`.
 *
 * Two control shapes, curated below:
 *  - toggle: a single tag that's either present (1, "on") or absent ("off").
 *  - select: a mutually-exclusive group of tags (e.g. lining vs oldstyle
 *    figures) where at most one tag in the group may be set at a time, plus
 *    an implicit "default" choice (tag: null) meaning "none of them set".
 *
 * Rendering fidelity: the DOM-rendered paths (`InlineTextEditor`, HTML/CSS
 * export) apply the real `font-feature-settings` string and get correct
 * glyphs wherever the loaded font implements a feature. Pixi's canvas-text
 * renderer has no equivalent — canvas `ctx.font` has no slot for
 * `font-feature-settings` — so `fontFeatures` is a documented no-op in the
 * Pixi editor canvas (verified in-browser that even the one candidate
 * canvas-native approximation, `font-variant: small-caps` for `smcp`,
 * renders as a plain uppercase substitution rather than true small caps, so
 * it isn't used either).
 */

/** A single boolean OpenType feature, e.g. discretionary ligatures. */
export interface OpenTypeToggleFeature {
  /** 4-char OpenType feature tag. */
  tag: string;
  label: string;
}

/** One choice within a mutually-exclusive `OpenTypeSelectGroup`. `tag: null` is the default ("none set"). */
export interface OpenTypeFeatureOption {
  tag: string | null;
  label: string;
}

/** A set of mutually-exclusive OpenType feature tags exposed as a single select. */
export interface OpenTypeSelectGroup {
  /** Stable identifier for the group (not an OpenType tag itself). */
  key: string;
  label: string;
  options: OpenTypeFeatureOption[];
}

/** Curated toggle features (task scope: discretionary ligatures, small caps, fractions, slashed zero). */
export const OPEN_TYPE_TOGGLE_FEATURES: OpenTypeToggleFeature[] = [
  { tag: "dlig", label: "Discretionary ligatures" },
  { tag: "smcp", label: "Small caps" },
  { tag: "frac", label: "Fractions" },
  { tag: "zero", label: "Slashed zero" },
];

/**
 * Curated mutually-exclusive groups: numeral figure style (lining/oldstyle),
 * numeral figure spacing (proportional/tabular — independent of figure style,
 * per OpenType spec).
 */
export const OPEN_TYPE_SELECT_GROUPS: OpenTypeSelectGroup[] = [
  {
    key: "numeralForm",
    label: "Figure style",
    options: [
      { tag: null, label: "Default" },
      { tag: "lnum", label: "Lining" },
      { tag: "onum", label: "Oldstyle" },
    ],
  },
  {
    key: "numeralSpacing",
    label: "Figure spacing",
    options: [
      { tag: null, label: "Default" },
      { tag: "pnum", label: "Proportional" },
      { tag: "tnum", label: "Tabular" },
    ],
  },
];

function isStylisticSetTag(tag: string): boolean {
  return /^ss\d{2}$/.test(tag);
}

/** Remove retired stylistic-set (`ss##`) tags from a feature map. */
export function withoutStylisticSetFeatures(
  features: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!features) return features;
  return Object.fromEntries(
    Object.entries(features).filter(([tag]) => !isStylisticSetTag(tag)),
  );
}

/**
 * Build the CSS `font-feature-settings` value from a node's feature map,
 * e.g. `{ dlig: 1, tnum: 1 }` -> `"dlig" 1, "tnum" 1`. Returns `undefined`
 * when there's nothing to express, mirroring
 * `variableFont.ts`'s `toFontVariationSettingsCss`.
 */
export function toFontFeatureSettingsCss(
  features: Record<string, number> | undefined,
): string | undefined {
  if (!features) return undefined;
  const entries = Object.entries(features).filter(
    ([tag, v]) => !isStylisticSetTag(tag) && typeof v === "number" && !Number.isNaN(v),
  );
  if (entries.length === 0) return undefined;
  return entries.map(([tag, value]) => `"${tag}" ${value}`).join(", ");
}

/** Turn a single boolean feature tag on (value 1) or off (key removed). Pure — never mutates `features`. */
export function withToggleFeature(
  features: Record<string, number> | undefined,
  tag: string,
  on: boolean,
): Record<string, number> {
  const next = withoutStylisticSetFeatures(features) ?? {};
  if (on) {
    next[tag] = 1;
  } else {
    delete next[tag];
  }
  return next;
}

/** The tag currently active within `group`, or `null` if none of the group's tags are set. */
export function getGroupSelection(
  features: Record<string, number> | undefined,
  group: OpenTypeSelectGroup,
): string | null {
  if (!features) return null;
  for (const option of group.options) {
    if (option.tag !== null && features[option.tag] === 1) return option.tag;
  }
  return null;
}

/**
 * Select one option within a mutually-exclusive group: clears every other
 * tag belonging to the group, then sets `tag` (unless `tag` is `null`, the
 * "default/none" option). Pure — never mutates `features`. This is what
 * keeps lining/oldstyle and proportional/tabular from ever having two
 * siblings active at once.
 */
export function withGroupSelection(
  features: Record<string, number> | undefined,
  group: OpenTypeSelectGroup,
  tag: string | null,
): Record<string, number> {
  const next = withoutStylisticSetFeatures(features) ?? {};
  for (const option of group.options) {
    if (option.tag !== null) delete next[option.tag];
  }
  if (tag !== null) next[tag] = 1;
  return next;
}
