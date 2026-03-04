import { PropertiesPanel } from "./PropertiesPanel";
import { useFloatingPanelsStore } from "@/store/floatingPanelsStore";

export function RightSidebar() {
  const isFloating = useFloatingPanelsStore((s) => s.isFloating);

  return (
    <div className={
      isFloating
        ? "w-[260px] h-full flex flex-col bg-surface-panel rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)] border border-border-default overflow-hidden"
        : "w-[260px] h-full flex flex-col bg-surface-panel border-l border-border-default"
    }>
      <PropertiesPanel />
    </div>
  );
}
