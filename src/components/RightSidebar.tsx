import { PropertiesPanel } from "./PropertiesPanel";
import { PageControls } from "./PageControls";

export function RightSidebar() {
  return (
    <div className="w-[300px] h-full flex flex-col bg-surface-panel border-l border-border-default">
      <PageControls />
      <PropertiesPanel />
    </div>
  );
}
