import type { ToolHandler } from "../toolRegistry";

// Kept byte-identical to the backend's GUIDELINES map
// (pen-editor-backend/src/ai/tools.ts) — the backend is the source of truth.
// src/lib/__tests__/toolContract.test.ts enforces this against the sibling
// checkout when it exists. Update the backend first, then copy verbatim here.
export const guidelines: Record<string, string> = {
  "design-system":
    "## Sizing & Auto-Layout Rules\n" +
    "CRITICAL: When creating frames with layout (vertical/horizontal), you MUST explicitly set width and height. " +
    "Never leave them as default — the default is a fixed pixel size which breaks auto-layout.\n" +
    "- Use `width: \"fill_container\"` for children that should stretch to parent width.\n" +
    "- Use `height: \"fill_container\"` for children that should stretch to parent height.\n" +
    "- Use `width: \"fit_content\"` or `height: \"fit_content\"` for content-sized elements.\n" +
    "- Use `height: \"fit_content(900)\"` for screens/sections that need a minimum height but grow with content.\n" +
    "- Only use fixed pixel values for elements with a known exact size (icons, avatars, fixed sidebars).\n" +
    "- Screen root frames: `width: 1440, height: \"fit_content(900)\"`.\n" +
    "- Content areas inside screens: `width: \"fill_container\", height: \"fit_content\"` or `height: \"fill_container\"`.\n" +
    "- Wrapper/container frames: ALWAYS set `height: \"fit_content\"` — they should grow with content.\n" +
    "- Card grids / tag lists: set `wrap: true` on the frame plus a fixed/fill `width` and `height: \"fit_content\"` so rows wrap and the frame hugs the total row height. Use `rowGap`/`columnGap` for independent row/column spacing (each falls back to `gap`).\n" +
    "- Use `minWidth`/`maxWidth`/`minHeight`/`maxHeight` on a child to clamp its resolved size (e.g. a `fill_container` card capped at `maxWidth: 320` so it doesn't stretch too wide in a wide row).\n\n" +
    "### Examples\n" +
    "WRONG: `I(screen, {type: \"frame\", layout: \"vertical\", gap: 16})` — no width/height, will use fixed defaults!\n" +
    "RIGHT: `I(screen, {type: \"frame\", layout: \"vertical\", gap: 16, width: \"fill_container\", height: \"fit_content\"})`\n\n" +
    "## Component Usage\n" +
    "- A reusable component is a native `frame` node with `reusable: true` — NOT an embed node. Use `get_editor_state`/`batch_get` to discover existing ones (search `type: \"frame\"`, check `reusable`).\n" +
    "- An instance is a `ref` node: `inst=I(parent, {type: \"ref\", componentId: \"<componentFrameId>\", width, height})`. Do NOT recreate a component's UI from scratch with frame/rect/text — insert a `ref` pointing at it instead.\n" +
    "- Per-instance customization goes through **overrides**, addressed by descendant path (a child's id, or `\"childId/grandchildId\"` for nested descendants): `U(inst+\"/label\", {text: \"Buy now\"})` sets a property on that instance only, leaving the component and other instances untouched.\n" +
    "- **Component properties (variants)**: a component can declare typed, named switches via `properties` on the component frame — `variant` (enum, e.g. state=default/hover/pressed), `boolean` (e.g. showIcon), or `text` (e.g. label). Each property is `{id, name, type, variantOptions?, defaultValue, bindingPath, bindingProp}`, where `bindingPath`/`bindingProp` name the descendant path and field the property controls (the same addressing as an override). `bindingProp` must be the node's INTERNAL field name, not an AI-input alias — use `\"text\"` for a text node's content (NOT `\"content\"`, which is only accepted by `U()`'s own alias mapping, not by `bindingProp`).\n" +
    "- **Important sequencing**: `componentId`, `bindingPath`, and any other id referenced *inside a nested `{...}`/`[...]` object* only resolve if written as a quoted string of a REAL, already-existing node id — same-call bindings (e.g. `comp=I(...)`) only substitute as bare top-level arguments (parent/sourceId/path), never inside nested JSON. So: create the component and its descendants in one `batch_design` call, read their real ids off the returned `createdNodes`, then in a follow-up call declare `properties` and/or create the `ref` instance using those ids as quoted strings.\n" +
    "  Call 1: `comp=I(document, {type: \"frame\", name: \"Button\", reusable: true, width: 120, height: 40})\\nlabel=I(comp, {type: \"text\", content: \"Click me\", width: 80, height: 20})` → returns e.g. `comp` id `\"n1\"`, `label` id `\"n2\"`.\n" +
    "  Call 2: `U(\"n1\", {properties: [{id: \"state\", name: \"State\", type: \"variant\", variantOptions: [\"default\",\"hover\"], defaultValue: \"default\", bindingPath: \"n2\", bindingProp: \"fill\"}]})\\ninst=I(document, {type: \"ref\", componentId: \"n1\", width: 120, height: 40})`.\n" +
    "- An instance selects a property's value via `propertyValues` (keyed by property id), NOT via `overrides`: `U(inst, {propertyValues: {state: \"hover\"}})` (`inst` here is a real id from a previous result, quoted, or a same-call top-level binding). `U()` merges `propertyValues` by key (setting one property never clobbers others already selected on the instance), and switching a property never touches the instance's `overrides` — both apply together, with an explicit override at the same path winning.\n" +
    "- When creating new designs, reuse existing components (and their declared variants) rather than building UI from scratch.\n\n" +
    "## Layout Patterns\n" +
    "- Sidebar + Content: sidebar with fixed width (240-280px), main with `width: \"fill_container\"`.\n" +
    "- Card grids: horizontal frame with `gap: 16-24`, cards with `width: \"fill_container\"`.\n" +
    "- Form fields: vertical frame with `gap: 16`, inputs with `width: \"fill_container\"`.\n\n" +
    "## Design Tokens\n" +
    "- Always use `$--variable` tokens for colors, never hardcode hex values.\n" +
    "- Colors: `$--background`, `$--foreground`, `$--muted-foreground`, `$--primary`, `$--border`, `$--card`.\n" +
    "- Typography: `$--font-primary` (headings), `$--font-secondary` (body).\n" +
    "- Border radius: `$--radius-none`, `$--radius-m`, `$--radius-pill`.\n\n" +
    "## Spacing Reference\n" +
    "- Screen sections gap: 24-32. Card grid gap: 16-24. Form fields gap: 16.\n" +
    "- Inside cards padding: 24. Page content padding: 32. Button padding: [10, 16].\n" +
    "- Maintain consistent spacing — pick from the established scale, don't use arbitrary values.",
  code:
    "When generating code from designs, use semantic HTML elements. " +
    "Map frame layouts to CSS flexbox. Map auto-layout direction to flex-direction. " +
    "Use CSS custom properties for theme variables. Export assets as needed.",
  table:
    "Build tables using nested frames with auto-layout. " +
    "Use a vertical frame for rows and horizontal frames for cells. " +
    "Keep header row as a separate component for reuse. " +
    "Apply consistent padding and borders across cells.",
  tailwind:
    "Map design tokens to Tailwind utility classes. " +
    "Use flex/grid for frame layouts. Apply gap-* for spacing. " +
    "Use p-* for padding, rounded-* for corner radius. " +
    "Map fill colors to bg-* and text colors to text-*.",
  "landing-page":
    "Structure landing pages with a hero section, features grid, testimonials, and CTA. " +
    "Use large typography for headings (48-72px). " +
    "Maintain visual hierarchy with consistent spacing (64-128px between sections). " +
    "Include responsive breakpoints for mobile and desktop.",
};

export const getGuidelines: ToolHandler = async (args) => {
  const topic = args.topic as string | undefined;
  if (!topic || !guidelines[topic]) {
    return JSON.stringify({
      error: `Invalid topic. Available topics: ${Object.keys(guidelines).join(", ")}`,
    });
  }
  return JSON.stringify({ topic, guidelines: guidelines[topic] });
};

export const getStyleGuideTags: ToolHandler = async () => {
  return JSON.stringify({
    tags: {
      style: ["minimal", "bold", "elegant", "playful", "corporate", "modern", "retro", "brutalist"],
      color: ["monochrome", "vibrant", "pastel", "dark", "light", "warm", "cool", "earth-tones"],
      industry: ["saas", "ecommerce", "finance", "healthcare", "education", "creative", "technology"],
      platform: ["mobile", "website", "webapp", "dashboard"],
      layout: ["grid", "asymmetric", "centered", "full-width", "card-based", "sidebar"],
    },
  });
};

export const getStyleGuide: ToolHandler = async (args) => {
  const tags = (Array.isArray(args.tags) ? args.tags : []) as string[];
  const name = args.name as string | undefined;
  return JSON.stringify({
    name: name ?? "Generated Style Guide",
    basedOn: tags,
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      sizes: { h1: 48, h2: 36, h3: 24, h4: 18, body: 16, small: 14, caption: 12 },
      weights: { heading: "700", body: "400", emphasis: "600" },
    },
    colors: {
      primary: "#3B82F6",
      secondary: "#8B5CF6",
      accent: "#F59E0B",
      background: "#FFFFFF",
      surface: "#F8FAFC",
      text: "#0F172A",
      textMuted: "#64748B",
      border: "#E2E8F0",
      success: "#22C55E",
      error: "#EF4444",
      warning: "#F59E0B",
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, section: 64 },
    borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  });
};
