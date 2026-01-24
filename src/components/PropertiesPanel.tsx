import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import type { SceneNode } from '../types/scene'
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
} from './ui/PropertyInputs'

function Header() {
  return (
    <div className="px-4 py-3 border-b border-border-default text-xs font-semibold text-white uppercase tracking-wide">
      Properties
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-text-disabled text-xs text-center p-5">
      Select a layer to view properties
    </div>
  )
}

function MultiSelectState({ count }: { count: number }) {
  return (
    <div className="text-text-muted text-xs text-center p-5">
      {count} layers selected
    </div>
  )
}

interface PropertyEditorProps {
  node: SceneNode
  onUpdate: (updates: Partial<SceneNode>) => void
}

function PropertyEditor({ node, onUpdate }: PropertyEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Position Section */}
      <PropertySection title="Position">
        <PropertyRow>
          <NumberInput
            label="X"
            value={node.x}
            onChange={(v) => onUpdate({ x: v })}
          />
          <NumberInput
            label="Y"
            value={node.y}
            onChange={(v) => onUpdate({ y: v })}
          />
        </PropertyRow>
      </PropertySection>

      {/* Size Section */}
      <PropertySection title="Size">
        <PropertyRow>
          <NumberInput
            label="W"
            value={node.width}
            onChange={(v) => onUpdate({ width: v })}
            min={1}
          />
          <NumberInput
            label="H"
            value={node.height}
            onChange={(v) => onUpdate({ height: v })}
            min={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* Fill Section */}
      <PropertySection title="Fill">
        <ColorInput
          value={node.fill ?? '#000000'}
          onChange={(v) => onUpdate({ fill: v })}
        />
      </PropertySection>

      {/* Stroke Section */}
      <PropertySection title="Stroke">
        <ColorInput
          value={node.stroke ?? ''}
          onChange={(v) => onUpdate({ stroke: v || undefined })}
        />
        <NumberInput
          label="Width"
          value={node.strokeWidth ?? 0}
          onChange={(v) => onUpdate({ strokeWidth: v })}
          min={0}
          step={0.5}
        />
      </PropertySection>

      {/* Corner Radius (Frame & Rect only) */}
      {(node.type === 'frame' || node.type === 'rect') && (
        <PropertySection title="Corner Radius">
          <NumberInput
            label="Radius"
            value={node.cornerRadius ?? 0}
            onChange={(v) => onUpdate({ cornerRadius: v })}
            min={0}
          />
        </PropertySection>
      )}

      {/* Text Properties (Text only) */}
      {node.type === 'text' && (
        <>
          <PropertySection title="Text">
            <TextInput
              value={node.text}
              onChange={(v) => onUpdate({ text: v } as Partial<SceneNode>)}
            />
          </PropertySection>
          <PropertySection title="Font">
            <NumberInput
              label="Size"
              value={node.fontSize ?? 16}
              onChange={(v) => onUpdate({ fontSize: v } as Partial<SceneNode>)}
              min={1}
            />
            <TextInput
              label="Family"
              value={node.fontFamily ?? 'Arial'}
              onChange={(v) => onUpdate({ fontFamily: v } as Partial<SceneNode>)}
            />
          </PropertySection>
        </>
      )}
    </div>
  )
}

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.nodes)
  const updateNode = useSceneStore((s) => s.updateNode)
  const { selectedIds } = useSelectionStore()

  // Find selected node
  const selectedNode =
    selectedIds.length === 1
      ? nodes.find((n) => n.id === selectedIds[0])
      : null

  // Handle update with type-safe callback
  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (selectedNode) {
      updateNode(selectedNode.id, updates)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header />
      <div className="flex-1 overflow-y-auto p-3">
        {selectedIds.length === 0 && <EmptyState />}
        {selectedIds.length > 1 && <MultiSelectState count={selectedIds.length} />}
        {selectedNode && (
          <PropertyEditor node={selectedNode} onUpdate={handleUpdate} />
        )}
      </div>
    </div>
  )
}
