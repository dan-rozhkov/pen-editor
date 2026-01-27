import { Frame, Square, Circle, Type } from 'lucide-react'
import { useDrawModeStore, type DrawToolType } from '../store/drawModeStore'

export function PrimitivesPanel() {
  const { activeTool, toggleTool } = useDrawModeStore()

  const tools: Array<{ icon: typeof Frame; label: string; tool: DrawToolType; shortcut: string }> = [
    { icon: Frame, label: 'Frame', tool: 'frame', shortcut: 'F' },
    { icon: Square, label: 'Rectangle', tool: 'rect', shortcut: 'R' },
    { icon: Circle, label: 'Ellipse', tool: 'ellipse', shortcut: 'O' },
    { icon: Type, label: 'Text', tool: 'text', shortcut: 'T' },
  ]

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 px-2 py-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-xl shadow-lg">
        {tools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive = activeTool === tool
          return (
            <button
              key={label}
              onClick={() => toggleTool(tool)}
              title={`${label} (${shortcut})`}
              className={`group relative p-2.5 rounded-lg transition-colors duration-150 ${
                isActive
                  ? 'bg-blue-500 text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
              }`}
            >
              <Icon size={20} strokeWidth={1.5} />
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-surface-elevated text-text-primary text-xs rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none">
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
