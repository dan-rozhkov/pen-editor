import { LayersPanel } from './LayersPanel'

export function LeftSidebar() {
  return (
    <div className="w-[240px] h-full flex flex-col bg-surface-panel border-r border-border-default">
      <LayersPanel />
    </div>
  )
}
