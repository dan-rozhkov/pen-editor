import type { ToolHandler } from "../toolRegistry";

const guidelines: Record<string, string> = {
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
    "- Wrapper/container frames: ALWAYS set `height: \"fit_content\"` — they should grow with content.\n\n" +
    "### Examples\n" +
    "WRONG: `I(screen, {type: \"frame\", layout: \"vertical\", gap: 16})` — no width/height, will use fixed defaults!\n" +
    "RIGHT: `I(screen, {type: \"frame\", layout: \"vertical\", gap: 16, width: \"fill_container\", height: \"fit_content\"})`\n\n" +
    "## Component Usage\n" +
    "- Use reusable components (frames with reusable: true) as building blocks.\n" +
    "- Insert instances via ref nodes: `{type: \"ref\", ref: \"componentId\"}`.\n" +
    "- Override descendant properties using the descendants map.\n" +
    "- Use slots (frames with `slot` property) to insert child content into components.\n" +
    "- Disable unused slots with `enabled: false`.\n\n" +
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
