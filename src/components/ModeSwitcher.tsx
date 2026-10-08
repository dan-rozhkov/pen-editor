import { MoonIcon, SunIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { THEME_COLLECTION_ID } from "@/types/variable";
import { getSwitchableCollections, toggleCanvasMode } from "@/lib/variables/canvasMode";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { IconButton } from "./ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * Switches the canvas mode: which mode of each variable collection the design
 * shows. This is the document's look (writes `themeStore.modeContext`), NOT
 * the editor chrome theme; that is `uiThemeStore` and lives in the View menu.
 */
export function ModeSwitcher() {
  const collections = useVariableStore((s) => s.collections);
  const modeContext = useThemeStore((s) => s.modeContext);
  const switchable = getSwitchableCollections(collections);

  if (switchable.length === 0) return null;

  const onlyTheme = switchable.length === 1 && switchable[0].id === THEME_COLLECTION_ID;

  if (onlyTheme) {
    const theme = switchable[0];
    const current = modeContext[THEME_COLLECTION_ID] ?? theme.defaultModeId;
    const isDark = current === "dark";
    return (
      <IconButton
        variant="ghost"
        size="icon-sm"
        tooltip="Canvas mode"
        aria-label={`Canvas mode: ${isDark ? "dark" : "light"}. Switch to ${isDark ? "light" : "dark"}`}
        data-testid="mode-switcher-toggle"
        onClick={() => toggleCanvasMode()}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </IconButton>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" aria-label="Canvas mode" data-testid="mode-switcher-trigger" />}
      >
        <SlidersHorizontalIcon />
        Canvas mode
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-56 gap-3 p-3" aria-label="Canvas mode">
        {switchable.map((collection) => {
          const current = modeContext[collection.id] ?? collection.defaultModeId;
          return (
            <div
              key={collection.id}
              role="group"
              aria-label={collection.name}
              className="flex flex-col gap-1"
            >
              <span className="text-xs text-text-muted">{collection.name}</span>
              <div className="flex flex-wrap gap-1">
                {collection.modes.map((mode) => {
                  const active = mode.id === current;
                  return (
                    <Button
                      key={mode.id}
                      size="sm"
                      variant={active ? "secondary" : "ghost"}
                      aria-pressed={active}
                      className={cn(active && "bg-accent-selection")}
                      onClick={() => useThemeStore.getState().setCollectionMode(collection.id, mode.id)}
                    >
                      {mode.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
