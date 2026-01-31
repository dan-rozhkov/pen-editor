import { LayersPanel } from "./LayersPanel";
import { ComponentsPanel } from "./ComponentsPanel";
import { Toolbar } from "./Toolbar";

export function LeftSidebar() {
  return (
    <div className="w-[240px] h-full flex flex-col bg-surface-panel border-r border-border-default">
      <Toolbar />
      <ComponentsPanel />
      <LayersPanel />
    </div>
  );
}
