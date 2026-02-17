import type { ToolHandler } from "../toolRegistry";

export const getGuidelines: ToolHandler = async (args) => {
  const topic = args.topic as string | undefined;

  const guidelines: Record<string, string> = {
    "design-system":
      "Use reusable components (frames with reusable: true) as building blocks. " +
      "Insert instances via ref nodes with componentId pointing to the component. " +
      "Override descendant properties using the descendants map. " +
      "Maintain consistent spacing, colors, and typography across screens.",
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

  if (!topic || !guidelines[topic]) {
    return JSON.stringify({
      error: `Invalid topic. Available topics: ${Object.keys(guidelines).join(", ")}`,
    });
  }

  return JSON.stringify({ topic, guidelines: guidelines[topic] });
};

export const getStyleGuideTags: ToolHandler = async () => {
  const tags = {
    style: ["minimal", "bold", "elegant", "playful", "corporate", "modern", "retro", "brutalist"],
    color: ["monochrome", "vibrant", "pastel", "dark", "light", "warm", "cool", "earth-tones"],
    industry: ["saas", "ecommerce", "finance", "healthcare", "education", "creative", "technology"],
    platform: ["mobile", "website", "webapp", "dashboard"],
    layout: ["grid", "asymmetric", "centered", "full-width", "card-based", "sidebar"],
  };

  return JSON.stringify({ tags });
};

export const getStyleGuide: ToolHandler = async (args) => {
  const tags = args.tags as string[] | undefined;
  const name = args.name as string | undefined;

  const styleGuide = {
    name: name ?? "Generated Style Guide",
    basedOn: tags ?? [],
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
  };

  return JSON.stringify(styleGuide);
};
