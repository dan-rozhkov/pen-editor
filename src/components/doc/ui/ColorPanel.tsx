import { DOC_COLORS, type DocColor } from "../docPalette";
import { cn } from "@/lib/utils";
import { MENU_HOVER } from "./menuSurface";

interface Props {
  activeText?: DocColor | null;
  activeBackground?: DocColor | null;
  onText: (color: DocColor) => void;
  onBackground: (color: DocColor) => void;
  onClear: () => void;
}

const cap = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Notion-style colour picker body: a "Text colour" row, a "Background" row and "Default". */
export function ColorPanel({ activeText, activeBackground, onText, onBackground, onClear }: Props) {
  return (
    // `doc-prose` supplies the palette variables (docProse.css) to this portaled panel.
    <div className="doc-prose text-menu-foreground flex flex-col gap-2 p-2 text-xs" style={{ minHeight: 0 }} onMouseDown={(event) => event.preventDefault()}>
      <Row label="Text colour">
        {DOC_COLORS.map((name) => (
          <Swatch key={name} label={`${cap(name)} text`} active={activeText === name} onPick={() => onText(name)}>
            <span data-color={name} className="flex size-4 items-center justify-center text-sm font-semibold">A</span>
          </Swatch>
        ))}
      </Row>
      <Row label="Background">
        {DOC_COLORS.map((name) => (
          <Swatch key={name} label={`${cap(name)} background`} active={activeBackground === name} onPick={() => onBackground(name)}>
            <span data-bg={name} className="size-4 !p-0 ring-1 ring-menu-foreground/25" />
          </Swatch>
        ))}
      </Row>
      <button
        type="button"
        className={cn(MENU_HOVER, "text-menu-foreground min-h-8 rounded-[10px] px-2.5 py-1.5 text-left text-[13px]")}
        onClick={onClear}
      >
        Default
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <span className="px-0.5 text-[11px] font-medium text-menu-muted-foreground">{label}</span>
      <div className="grid grid-cols-9 gap-1">{children}</div>
    </div>
  );
}

function Swatch({ label, active, onPick, children }: { label: string; active: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        MENU_HOVER,
        "focus-visible:ring-menu-foreground/40 flex size-6 items-center justify-center rounded-control-sm outline-none focus-visible:ring-2",
        active && "bg-menu-highlight ring-menu-foreground/40 ring-1",
      )}
    >
      {children}
    </button>
  );
}
