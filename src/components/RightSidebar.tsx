import { PropertiesPanel } from "./PropertiesPanel";
import { PageControls } from "./PageControls";

export function RightSidebar() {
  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-panel border-l border-border-default">
      <PageControls />
      <PropertiesPanel />
    </div>
  );
}
