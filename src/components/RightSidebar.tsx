import { VariablesPanel } from './VariablesPanel'
import { LayersPanel } from './LayersPanel'
import { PropertiesPanel } from './PropertiesPanel'

export function RightSidebar() {
  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-panel border-l border-border-default">
      <VariablesPanel />
      <LayersPanel />
      <PropertiesPanel />
    </div>
  )
}
