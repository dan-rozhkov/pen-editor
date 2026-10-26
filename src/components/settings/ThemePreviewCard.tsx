import { Radio } from "@base-ui/react/radio";
import { CheckIcon } from "@/components/icons";

import type { UITheme } from "@/lib/uiTheme";

// The miniature must show its OWN theme whatever theme the page is in, so it
// carries literal copies of the tokens in index.css rather than var(--color-*).
const PALETTES: Record<UITheme, { base: string; panel: string; line: string; muted: string; border: string }> = {
  light: { base: "#f5f5f5", panel: "#ffffff", line: "#e5e5e5", muted: "#d0d0d0", border: "#e0e0e0" },
  dark: { base: "#1a1a1a", panel: "#2a2a2a", line: "#4a4a4a", muted: "#555555", border: "#404040" },
};

function Line({ width, color }: { width: string; color: string }) {
  return <div className="h-1.5 rounded-full" style={{ width, backgroundColor: color }} />;
}

/** A radio card: a drawing of the editor chrome in one theme, a label under it, an accent ring when picked. */
export function ThemePreviewCard({ theme, label }: { theme: UITheme; label: string }) {
  const c = PALETTES[theme];
  return (
    <Radio.Root
      value={theme}
      aria-label={label}
      className="group flex w-full max-w-56 cursor-default flex-col gap-2 text-left outline-none"
    >
      <span
        className="relative block aspect-[16/10] overflow-hidden rounded-lg border group-data-checked:border-transparent group-data-checked:ring-2 group-data-checked:ring-accent-primary group-focus-visible:ring-2 group-focus-visible:ring-accent-primary"
        style={{ backgroundColor: c.base, borderColor: c.border }}
        aria-hidden
      >
        <span className="absolute top-2 left-2 flex gap-1">
          {["#ff5f57", "#febc2e", "#28c840"].map((dot) => (
            <span key={dot} className="size-1.5 rounded-full" style={{ backgroundColor: dot }} />
          ))}
        </span>
        <span className="absolute inset-y-0 left-0 flex w-1/4 flex-col gap-1.5 px-2 pt-7" style={{ backgroundColor: c.base }}>
          <Line width="80%" color={c.muted} />
          <Line width="60%" color={c.line} />
          <Line width="70%" color={c.line} />
        </span>
        <span
          className="absolute top-5 right-2 bottom-2 left-[28%] flex flex-col gap-1.5 rounded-md p-2"
          style={{ backgroundColor: c.panel, border: `1px solid ${c.border}` }}
        >
          <Line width="45%" color={c.muted} />
          <Line width="90%" color={c.line} />
          <Line width="75%" color={c.line} />
          <Line width="60%" color={c.line} />
        </span>
        <Radio.Indicator className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-accent-primary text-white">
          <CheckIcon className="size-2.5" />
        </Radio.Indicator>
      </span>
      <span className="text-xs font-medium text-text-primary">{label}</span>
    </Radio.Root>
  );
}
