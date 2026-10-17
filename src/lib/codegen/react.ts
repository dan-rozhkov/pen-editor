import type { FlatFrameNode, FlatSceneNode, LayoutProperties, TextNode } from "@/types/scene";
import { BACKGROUND_STYLE_KEYS } from "@/lib/designToHtml/styleGeneration";
import { getRenderableFills } from "@/utils/fillUtils";
import { type CodegenOptions, convertPxToRem } from "./css";
import { nodeDeclarations } from "./declarations";
import {
  declarationsToTailwind,
  collectSubtreeVariableIds,
  tokensBlockForIds,
  UNSUPPORTED_NODE_TYPES,
  unsupportedNodeWarning,
  videoFillWarning,
  hasVideoFill,
} from "./tailwind";

export interface BuildReactCodeResult {
  code: string;
  warnings: string[];
}

/** `nodesById`/`childrenById` value types shared with the sibling `styleMode`. */
type ReactCodegenOptions = CodegenOptions & { styleMode: "inline" | "tailwind" };

/** CSS keys emitted by `generateVisualStyles`' fill handling, kept alongside `BACKGROUND_STYLE_KEYS` as a `Set` for O(1) lookup. */
const BACKGROUND_KEY_SET = new Set<string>(BACKGROUND_STYLE_KEYS);

/**
 * Figma's default auto-generated name per node type (e.g. "Rectangle 12",
 * "Frame 3"), used to decide whether a child's name is worth surfacing as a
 * `{/* Name *\/}` comment. Not exhaustive of every renamed-by-user case — a
 * user who renames a node back to e.g. "Frame" is treated as default too,
 * which is an acceptable false negative for a comment that's cosmetic only.
 */
const DEFAULT_NAME_LABELS: Record<string, string> = {
  frame: "Frame",
  group: "Group",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  path: "Vector",
  line: "Line",
  polygon: "Polygon",
  embed: "Embed",
  ref: "Instance",
  connector: "Connector",
};

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

/**
 * Per-node-type "is this the Figma-style default name" regex, built once per
 * type rather than on every visited node (a deep tree can call
 * `isMeaningfulName` thousands of times). `DEFAULT_NAME_LABELS`' types are
 * precomputed eagerly; any other type falls back to a lazily-cached regex
 * keyed by the type string itself.
 */
const DEFAULT_NAME_REGEXES: Record<string, RegExp> = Object.fromEntries(
  Object.entries(DEFAULT_NAME_LABELS).map(([type, label]) => [type, new RegExp(`^${label}(\\s+\\d+)?$`, "i")]),
);
const nameRegexCache = new Map<string, RegExp>();

function defaultNameRegexFor(nodeType: string): RegExp {
  const known = DEFAULT_NAME_REGEXES[nodeType];
  if (known) return known;
  let re = nameRegexCache.get(nodeType);
  if (!re) {
    re = new RegExp(`^${nodeType}(\\s+\\d+)?$`, "i");
    nameRegexCache.set(nodeType, re);
  }
  return re;
}

/** Whether `name` is worth a `{/* Name *\/}` comment: non-empty and not a Figma-style default like "Rectangle 12". */
function isMeaningfulName(name: string | undefined, nodeType: string): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  return !defaultNameRegexFor(nodeType).test(trimmed);
}

/**
 * PascalCase a node's name for use as a JSX component identifier. Falls back
 * to `<Type>Component` (e.g. "RectComponent") whenever the sanitized name
 * doesn't satisfy `/^[A-Z][A-Za-z0-9]*$/` — empty names, names with no
 * letters/digits, or names starting with a digit.
 */
function componentNameFor(name: string | undefined, nodeType: string): string {
  const words = (name ?? "").match(/[A-Za-z0-9]+/g) ?? [];
  const pascal = words.map(capitalize).join("");
  if (/^[A-Z][A-Za-z0-9]*$/.test(pascal)) return pascal;
  return `${capitalize(nodeType)}Component`;
}

/**
 * Neutralize a `*&#47;`-breakout inside a JSX block comment (`{/* ... *&#47;}`)
 * by inserting a zero-width space between `*` and `/` wherever the raw text
 * contains that sequence, so untrusted node names can never close the
 * comment early and expose the rest as live JSX/JS. Also collapses
 * whitespace/newlines so the comment stays on one line.
 */
function sanitizeCommentText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\*\//g, "*​/").trim();
}

/**
 * Render `value` as a JS string literal via `JSON.stringify`, safe to drop
 * into a JSX expression container (`{...}`). This is the one escaping
 * strategy used for all untrusted text content (text-node content, `alt`
 * attributes): `{`, `}`, `<`, `>`, `&`, quotes, and backslashes can never
 * break out because the result is always a syntactically valid JS string.
 */
function jsxStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/** kebab-case CSS property -> camelCase JS property, e.g. "background-color" -> "backgroundColor", "-webkit-mask-image" -> "WebkitMaskImage" (React's vendor-prefix convention falls out of the same rule since the leading "-x" also capitalizes). */
function cssPropToCamel(prop: string): string {
  return prop.replace(/-([a-zA-Z0-9])/g, (_match, ch: string) => ch.toUpperCase());
}

function hasImageFill(node: FlatSceneNode): boolean {
  return getRenderableFills(node).some((paint) => paint.type === "image");
}

function omitBackgroundKeys(decls: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(decls).filter(([prop]) => !BACKGROUND_KEY_SET.has(prop)));
}

/** `{ prop: "value", ... }` source for a `style={{...}}` object; values are always JS string literals ("numeric-less"), px lengths converted to rem first when requested. */
function styleObjectSource(decls: Record<string, string>, options: CodegenOptions): string {
  const entries = Object.entries(decls).map(([prop, rawValue]) => {
    const key = cssPropToCamel(prop);
    const value = options.units === "rem" ? convertPxToRem(rawValue, options.remBase) : rawValue;
    return `${key}: ${JSON.stringify(value)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

/**
 * ` className={...}` (Task 2's Tailwind mapper) or ` style={{...}}`,
 * leading-space-prefixed and empty when there are no declarations.
 *
 * The className value is emitted as a JS string expression
 * (`className={JSON.stringify(...)}`), the same guaranteed-safe strategy
 * used for text content elsewhere in this file — never interpolated
 * directly into a `"..."` JSX attribute. An arbitrary-value class can
 * legitimately contain a `"` (e.g. a `pattern`/image fill's URL inside
 * `bg-[url("...")]`), which would otherwise break out of the attribute and
 * inject live JSX.
 */
function styleOrClassAttr(decls: Record<string, string>, options: ReactCodegenOptions): string {
  if (options.styleMode === "tailwind") {
    const classes = declarationsToTailwind(decls, options);
    return classes.length > 0 ? ` className={${jsxStringLiteral(classes.join(" "))}}` : "";
  }
  return Object.keys(decls).length > 0 ? ` style={${styleObjectSource(decls, options)}}` : "";
}

/**
 * Recursively render a node and its subtree as indented JSX (2 spaces per
 * depth level), reusing the same style generators / traversal shape as
 * `buildTailwindCode`'s `buildElement` (root: own layout + visual + text
 * styles; descendants: parent frame's `layout`, `isRoot: false`). A text node
 * becomes a `<div>` holding its escaped content as a JSX string expression;
 * a node with a renderable image fill becomes an `<img src="" alt="..." />`
 * placeholder with its non-background declarations kept (geometry, radius,
 * opacity, etc.); anything else is a `<div>`, self-closing when childless.
 * Missing node ids are recorded in `warnings` and skipped.
 */
function buildJsxElement(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  depth: number,
  options: ReactCodegenOptions,
  warnings: string[],
): string | null {
  const node = nodesById[nodeId];
  if (!node) {
    warnings.push(`Node not found: ${nodeId}`);
    return null;
  }

  const indent = "  ".repeat(depth);
  const decls = nodeDeclarations(node, parentLayout, isRoot);

  if (node.type === "text") {
    const attrs = styleOrClassAttr(decls, options);
    const content = jsxStringLiteral((node as TextNode).text ?? "");
    return `${indent}<div${attrs}>{${content}}</div>`;
  }

  if (hasImageFill(node)) {
    const attrs = styleOrClassAttr(omitBackgroundKeys(decls), options);
    const alt = jsxStringLiteral(node.name ?? "");
    return `${indent}<img src=""${attrs} alt={${alt}} />`;
  }

  if (UNSUPPORTED_NODE_TYPES.has(node.type)) {
    warnings.push(unsupportedNodeWarning(node));
  } else if (hasVideoFill(node)) {
    warnings.push(videoFillWarning(node));
  }

  const attrs = styleOrClassAttr(decls, options);
  const childIds = childrenById[nodeId] ?? [];
  if (childIds.length === 0) {
    return `${indent}<div${attrs} />`;
  }

  const childLayout = node.type === "frame" ? (node as FlatFrameNode).layout : undefined;
  const childDepth = depth + 1;
  const childIndent = "  ".repeat(childDepth);
  const childLines = childIds
    .map((childId) => {
      const childNode = nodesById[childId];
      const element = buildJsxElement(childId, nodesById, childrenById, childLayout, false, childDepth, options, warnings);
      if (element === null) return null;
      if (childNode && isMeaningfulName(childNode.name, childNode.type)) {
        const comment = `${childIndent}{/* ${sanitizeCommentText(childNode.name!)} */}`;
        return `${comment}\n${element}`;
      }
      return element;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  return `${indent}<div${attrs}>\n${childLines}\n${indent}</div>`;
}

/**
 * Generate a self-contained React function component for `nodeId`'s
 * subtree, reusing the same style generators as `buildCssCode` /
 * `buildTailwindCode` (no duplicated style logic). The component name is a
 * PascalCase sanitization of the root node's `name` (see
 * `componentNameFor`); `styleMode` picks `style={{...}}` (camelCase inline
 * styles) or `className="..."` (Tailwind utilities, via Task 2's
 * `declarationsToTailwind`).
 */
export function buildReactCode(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  options: ReactCodegenOptions,
): BuildReactCodeResult {
  const warnings: string[] = [];
  const node = nodesById[nodeId];
  if (!node) {
    warnings.push(`Node not found: ${nodeId}`);
    return { code: "", warnings };
  }

  const componentName = componentNameFor(node.name, node.type);
  const element = buildJsxElement(nodeId, nodesById, childrenById, undefined, true, 2, options, warnings) ?? "";
  const componentCode = `export function ${componentName}() {\n  return (\n${element}\n  );\n}\n`;

  const tokensBlock = tokensBlockForIds(collectSubtreeVariableIds(nodeId, nodesById, childrenById));
  const code = tokensBlock ? `/* Requires CSS variables:\n${tokensBlock}\n*/\n${componentCode}` : componentCode;
  return { code, warnings };
}
