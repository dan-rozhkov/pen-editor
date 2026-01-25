import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore, type InstanceContext } from '../store/selectionStore'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
import type { SceneNode, FrameNode, RefNode, FlexDirection, AlignItems, JustifyContent, SizingMode, TextNode, TextWidthMode, TextAlign, DescendantOverride } from '../types/scene'
import type { ThemeName, Variable } from '../types/variable'
import { findParentFrame, findNodeById, findComponentById, type ParentContext } from '../utils/nodeUtils'
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  ColorInput,
  TextInput,
  SelectInput,
  CheckboxInput,
  SegmentedControl,
} from './ui/PropertyInputs'

// Helper to find a node within a component's children tree
function findNodeInComponent(children: SceneNode[], nodeId: string): SceneNode | null {
  for (const child of children) {
    if (child.id === nodeId) return child
    if (child.type === 'frame') {
      const found = findNodeInComponent(child.children, nodeId)
      if (found) return found
    }
  }
  return null
}

function Header() {
  return (
    <div className="px-4 py-3 border-b border-border-default text-xs font-semibold text-text-primary uppercase tracking-wide">
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

// Override indicator for instance properties
function OverrideIndicator({ isOverridden, onReset }: { isOverridden: boolean; onReset: () => void }) {
  if (!isOverridden) return null
  return (
    <button
      onClick={onReset}
      className="ml-1 p-0.5 text-purple-400 hover:text-purple-300 flex-shrink-0"
      title="Reset to component value"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 6a4 4 0 107.5-2M9.5 1v3h-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

interface PropertyEditorProps {
  node: SceneNode
  onUpdate: (updates: Partial<SceneNode>) => void
  parentContext: ParentContext
  variables: Variable[]
  activeTheme: ThemeName
  allNodes: SceneNode[]
}

const sizingOptions = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'fill_container', label: 'Fill' },
  { value: 'fit_content', label: 'Fit' },
]

function PropertyEditor({ node, onUpdate, parentContext, variables, activeTheme, allNodes }: PropertyEditorProps) {
  // Get component if this is an instance (RefNode)
  const component = node.type === 'ref'
    ? findComponentById(allNodes, (node as RefNode).componentId)
    : null

  // Check if a property is overridden (defined on instance and different from component)
  const isOverridden = <T,>(instanceVal: T | undefined, componentVal: T | undefined): boolean => {
    if (!component) return false
    return instanceVal !== undefined && instanceVal !== componentVal
  }

  // Reset an override by setting property to undefined
  const resetOverride = (property: keyof SceneNode) => {
    onUpdate({ [property]: undefined } as Partial<SceneNode>)
  }

  // Handler for fill variable binding
  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ fillBinding: { variableId } })
    } else {
      onUpdate({ fillBinding: undefined })
    }
  }

  // Handler for stroke variable binding
  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ strokeBinding: { variableId } })
    } else {
      onUpdate({ strokeBinding: undefined })
    }
  }

  // Filter only color variables
  const colorVariables = variables.filter(v => v.type === 'color')

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
        {/* Show sizing mode controls when inside auto-layout */}
        {parentContext.isInsideAutoLayout && (
          <>
            <SegmentedControl
              label="W"
              value={node.sizing?.widthMode ?? 'fixed'}
              options={sizingOptions}
              onChange={(v) => onUpdate({ sizing: { ...node.sizing, widthMode: v as SizingMode } })}
            />
            <SegmentedControl
              label="H"
              value={node.sizing?.heightMode ?? 'fixed'}
              options={sizingOptions}
              onChange={(v) => onUpdate({ sizing: { ...node.sizing, heightMode: v as SizingMode } })}
            />
          </>
        )}
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

      {/* Rotation Section */}
      <PropertySection title="Rotation">
        <NumberInput
          label="°"
          value={node.rotation ?? 0}
          onChange={(v) => onUpdate({ rotation: v })}
          min={0}
          max={360}
          step={1}
        />
      </PropertySection>

      {/* Fill Section */}
      <PropertySection title="Fill">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={node.fill ?? component?.fill ?? '#000000'}
              onChange={(v) => onUpdate({ fill: v })}
              variableId={node.fillBinding?.variableId}
              onVariableChange={handleFillVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(node.fill, component?.fill)}
            onReset={() => resetOverride('fill')}
          />
        </div>
      </PropertySection>

      {/* Stroke Section */}
      <PropertySection title="Stroke">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={node.stroke ?? component?.stroke ?? ''}
              onChange={(v) => onUpdate({ stroke: v || undefined })}
              variableId={node.strokeBinding?.variableId}
              onVariableChange={handleStrokeVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(node.stroke, component?.stroke)}
            onReset={() => resetOverride('stroke')}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NumberInput
              label="Width"
              value={node.strokeWidth ?? component?.strokeWidth ?? 0}
              onChange={(v) => onUpdate({ strokeWidth: v })}
              min={0}
              step={0.5}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(node.strokeWidth, component?.strokeWidth)}
            onReset={() => resetOverride('strokeWidth')}
          />
        </div>
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

      {/* Auto Layout (Frame only) */}
      {node.type === 'frame' && (
        <PropertySection title="Auto Layout">
          <CheckboxInput
            label="Enable Auto Layout"
            checked={(node as FrameNode).layout?.autoLayout ?? false}
            onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, autoLayout: v } } as Partial<SceneNode>)}
          />
          {(node as FrameNode).layout?.autoLayout && (
            <>
              <SelectInput
                label="Direction"
                value={(node as FrameNode).layout?.flexDirection ?? 'row'}
                options={[
                  { value: 'row', label: 'Horizontal' },
                  { value: 'column', label: 'Vertical' },
                ]}
                onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, flexDirection: v as FlexDirection } } as Partial<SceneNode>)}
              />
              <NumberInput
                label="Gap"
                value={(node as FrameNode).layout?.gap ?? 0}
                onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, gap: v } } as Partial<SceneNode>)}
                min={0}
              />
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mt-2">
                Padding
              </div>
              <PropertyRow>
                <NumberInput
                  label="T"
                  value={(node as FrameNode).layout?.paddingTop ?? 0}
                  onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, paddingTop: v } } as Partial<SceneNode>)}
                  min={0}
                />
                <NumberInput
                  label="R"
                  value={(node as FrameNode).layout?.paddingRight ?? 0}
                  onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, paddingRight: v } } as Partial<SceneNode>)}
                  min={0}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="B"
                  value={(node as FrameNode).layout?.paddingBottom ?? 0}
                  onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, paddingBottom: v } } as Partial<SceneNode>)}
                  min={0}
                />
                <NumberInput
                  label="L"
                  value={(node as FrameNode).layout?.paddingLeft ?? 0}
                  onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, paddingLeft: v } } as Partial<SceneNode>)}
                  min={0}
                />
              </PropertyRow>
              <SelectInput
                label="Align"
                value={(node as FrameNode).layout?.alignItems ?? 'flex-start'}
                options={[
                  { value: 'flex-start', label: 'Start' },
                  { value: 'center', label: 'Center' },
                  { value: 'flex-end', label: 'End' },
                  { value: 'stretch', label: 'Stretch' },
                ]}
                onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, alignItems: v as AlignItems } } as Partial<SceneNode>)}
              />
              <SelectInput
                label="Justify"
                value={(node as FrameNode).layout?.justifyContent ?? 'flex-start'}
                options={[
                  { value: 'flex-start', label: 'Start' },
                  { value: 'center', label: 'Center' },
                  { value: 'flex-end', label: 'End' },
                  { value: 'space-between', label: 'Space Between' },
                ]}
                onChange={(v) => onUpdate({ layout: { ...(node as FrameNode).layout, justifyContent: v as JustifyContent } } as Partial<SceneNode>)}
              />
            </>
          )}
        </PropertySection>
      )}

      {/* Theme Override (Frame only) */}
      {node.type === 'frame' && (
        <PropertySection title="Theme Override">
          <SelectInput
            label="Theme"
            value={(node as FrameNode).themeOverride ?? 'inherit'}
            options={[
              { value: 'inherit', label: 'Inherit' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(v) =>
              onUpdate({
                themeOverride: v === 'inherit' ? undefined : (v as ThemeName),
              } as Partial<SceneNode>)
            }
          />
        </PropertySection>
      )}

      {/* Component (Frame only) */}
      {node.type === 'frame' && (
        <PropertySection title="Component">
          {(node as FrameNode).reusable ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-accent-primary">
                <svg viewBox="0 0 16 16" className="w-4 h-4">
                  <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 4 L4 2 L4 4 Z" fill="currentColor" />
                  <path d="M12 2 L14 4 L12 4 Z" fill="currentColor" />
                  <path d="M2 12 L4 14 L4 12 Z" fill="currentColor" />
                  <path d="M12 14 L14 12 L12 12 Z" fill="currentColor" />
                </svg>
                <span>This is a Component</span>
              </div>
              <button
                className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
                onClick={() => onUpdate({ reusable: false } as Partial<SceneNode>)}
              >
                Detach Component
              </button>
            </div>
          ) : (
            <button
              className="w-full px-3 py-1.5 bg-accent-primary border-none rounded text-white text-xs cursor-pointer transition-colors hover:bg-accent-hover"
              onClick={() => onUpdate({ reusable: true } as Partial<SceneNode>)}
            >
              Create Component
            </button>
          )}
        </PropertySection>
      )}

      {/* Instance info (RefNode only) */}
      {node.type === 'ref' && (() => {
        const refNode = node as RefNode
        const comp = findComponentById(allNodes, refNode.componentId)

        // Collect overridden properties
        const overrides: string[] = []
        if (isOverridden(node.fill, comp?.fill)) overrides.push('Fill')
        if (isOverridden(node.stroke, comp?.stroke)) overrides.push('Stroke')
        if (isOverridden(node.strokeWidth, comp?.strokeWidth)) overrides.push('Stroke Width')
        if (isOverridden(node.fillBinding, comp?.fillBinding)) overrides.push('Fill Variable')
        if (isOverridden(node.strokeBinding, comp?.strokeBinding)) overrides.push('Stroke Variable')

        return (
          <PropertySection title="Instance">
            <div className="flex items-center gap-2 text-xs text-purple-400">
              <svg viewBox="0 0 16 16" className="w-4 h-4">
                <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span>Instance of: {comp?.name || 'Component'}</span>
            </div>
            {overrides.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
                  Overrides ({overrides.length})
                </div>
                <div className="text-xs text-text-secondary">
                  {overrides.join(', ')}
                </div>
                <button
                  onClick={() => {
                    onUpdate({
                      fill: undefined,
                      stroke: undefined,
                      strokeWidth: undefined,
                      fillBinding: undefined,
                      strokeBinding: undefined,
                    })
                  }}
                  className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
                >
                  Reset All Overrides
                </button>
              </div>
            )}
          </PropertySection>
        )
      })()}

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
          <PropertySection title="Text Layout">
            <SegmentedControl
              label="Width"
              value={(node as TextNode).textWidthMode ?? 'fixed'}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'fixed', label: 'Fixed' },
              ]}
              onChange={(v) => onUpdate({ textWidthMode: v as TextWidthMode } as Partial<SceneNode>)}
            />
            <SegmentedControl
              label="Align"
              value={(node as TextNode).textAlign ?? 'left'}
              options={[
                { value: 'left', label: 'L' },
                { value: 'center', label: 'C' },
                { value: 'right', label: 'R' },
              ]}
              onChange={(v) => onUpdate({ textAlign: v as TextAlign } as Partial<SceneNode>)}
            />
            <NumberInput
              label="Line Height"
              value={(node as TextNode).lineHeight ?? 1.2}
              onChange={(v) => onUpdate({ lineHeight: v } as Partial<SceneNode>)}
              min={0.5}
              max={3}
              step={0.1}
            />
            <NumberInput
              label="Spacing"
              value={(node as TextNode).letterSpacing ?? 0}
              onChange={(v) => onUpdate({ letterSpacing: v } as Partial<SceneNode>)}
              min={-5}
              max={50}
              step={0.5}
            />
          </PropertySection>
        </>
      )}
    </div>
  )
}

// Editor for descendant nodes inside an instance
interface DescendantPropertyEditorProps {
  instanceContext: InstanceContext
  allNodes: SceneNode[]
  variables: Variable[]
  activeTheme: ThemeName
}

function DescendantPropertyEditor({
  instanceContext,
  allNodes,
  variables,
  activeTheme,
}: DescendantPropertyEditorProps) {
  const updateDescendantOverride = useSceneStore((s) => s.updateDescendantOverride)
  const resetDescendantOverride = useSceneStore((s) => s.resetDescendantOverride)
  const exitInstanceEditMode = useSelectionStore((s) => s.exitInstanceEditMode)

  // Find the instance and component
  const instance = findNodeById(allNodes, instanceContext.instanceId) as RefNode | null
  if (!instance || instance.type !== 'ref') return null

  const component = findComponentById(allNodes, instance.componentId)
  if (!component) return null

  // Find the original descendant node in the component
  const originalNode = findNodeInComponent(component.children, instanceContext.descendantId)
  if (!originalNode) return null

  // Get current override values
  const currentOverride = instance.descendants?.[instanceContext.descendantId] || {}

  // Merge original node with overrides for display
  const displayNode = { ...originalNode, ...currentOverride } as SceneNode

  // Check if a property is overridden
  const isPropertyOverridden = (property: keyof DescendantOverride): boolean => {
    return currentOverride[property] !== undefined
  }

  // Handle update - save to descendants
  const handleUpdate = (updates: Partial<SceneNode>) => {
    updateDescendantOverride(instanceContext.instanceId, instanceContext.descendantId, updates as DescendantOverride)
  }

  // Reset a specific property
  const handleResetProperty = (property: keyof DescendantOverride) => {
    resetDescendantOverride(instanceContext.instanceId, instanceContext.descendantId, property)
  }

  // Reset all overrides for this descendant
  const handleResetAll = () => {
    resetDescendantOverride(instanceContext.instanceId, instanceContext.descendantId)
  }

  // Filter only color variables
  const colorVariables = variables.filter(v => v.type === 'color')

  // Handler for fill variable binding
  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ fillBinding: { variableId } })
    } else {
      handleUpdate({ fillBinding: undefined })
    }
  }

  // Handler for stroke variable binding
  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ strokeBinding: { variableId } })
    } else {
      handleUpdate({ strokeBinding: undefined })
    }
  }

  // Collect overridden properties for display
  const overriddenProperties: string[] = []
  if (isPropertyOverridden('fill')) overriddenProperties.push('Fill')
  if (isPropertyOverridden('stroke')) overriddenProperties.push('Stroke')
  if (isPropertyOverridden('strokeWidth')) overriddenProperties.push('Stroke Width')
  if (isPropertyOverridden('enabled')) overriddenProperties.push('Enabled')
  if (isPropertyOverridden('fillBinding')) overriddenProperties.push('Fill Variable')
  if (isPropertyOverridden('strokeBinding')) overriddenProperties.push('Stroke Variable')

  return (
    <div className="flex flex-col gap-4">
      {/* Descendant Info */}
      <PropertySection title="Editing Descendant">
        <div className="flex items-center gap-2 text-xs text-purple-400">
          <svg viewBox="0 0 16 16" className="w-4 h-4">
            <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{originalNode.name || originalNode.type}</span>
        </div>
        <div className="text-[10px] text-text-muted mt-1">
          In instance: {instance.name || 'Instance'}
        </div>
        <button
          onClick={exitInstanceEditMode}
          className="mt-2 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
        >
          Exit Edit Mode
        </button>
      </PropertySection>

      {/* Enabled Toggle */}
      <PropertySection title="Visibility">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <CheckboxInput
              label="Enabled"
              checked={displayNode.enabled !== false}
              onChange={(v) => handleUpdate({ enabled: v ? undefined : false })}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden('enabled')}
            onReset={() => handleResetProperty('enabled')}
          />
        </div>
      </PropertySection>

      {/* Fill Section */}
      <PropertySection title="Fill">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.fill ?? originalNode.fill ?? '#000000'}
              onChange={(v) => handleUpdate({ fill: v })}
              variableId={displayNode.fillBinding?.variableId}
              onVariableChange={handleFillVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden('fill')}
            onReset={() => handleResetProperty('fill')}
          />
        </div>
      </PropertySection>

      {/* Stroke Section */}
      <PropertySection title="Stroke">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.stroke ?? originalNode.stroke ?? ''}
              onChange={(v) => handleUpdate({ stroke: v || undefined })}
              variableId={displayNode.strokeBinding?.variableId}
              onVariableChange={handleStrokeVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden('stroke')}
            onReset={() => handleResetProperty('stroke')}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NumberInput
              label="Width"
              value={displayNode.strokeWidth ?? originalNode.strokeWidth ?? 0}
              onChange={(v) => handleUpdate({ strokeWidth: v })}
              min={0}
              step={0.5}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden('strokeWidth')}
            onReset={() => handleResetProperty('strokeWidth')}
          />
        </div>
      </PropertySection>

      {/* Overrides Summary */}
      {overriddenProperties.length > 0 && (
        <PropertySection title="Overrides">
          <div className="text-xs text-text-secondary mb-2">
            {overriddenProperties.join(', ')}
          </div>
          <button
            onClick={handleResetAll}
            className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
          >
            Reset All Overrides
          </button>
        </PropertySection>
      )}
    </div>
  )
}

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.nodes)
  const updateNode = useSceneStore((s) => s.updateNode)
  const { selectedIds, instanceContext } = useSelectionStore()
  const variables = useVariableStore((s) => s.variables)
  const activeTheme = useThemeStore((s) => s.activeTheme)

  // Find selected node (recursively search in tree)
  const selectedNode =
    selectedIds.length === 1
      ? findNodeById(nodes, selectedIds[0])
      : null

  // Get parent context for sizing controls
  const parentContext: ParentContext = selectedNode
    ? findParentFrame(nodes, selectedNode.id)
    : { parent: null, isInsideAutoLayout: false }

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
        {/* If editing a descendant inside an instance, show descendant editor */}
        {instanceContext && (
          <DescendantPropertyEditor
            instanceContext={instanceContext}
            allNodes={nodes}
            variables={variables}
            activeTheme={activeTheme}
          />
        )}
        {/* Otherwise show normal property editor */}
        {selectedNode && !instanceContext && (
          <PropertyEditor
            node={selectedNode}
            onUpdate={handleUpdate}
            parentContext={parentContext}
            variables={variables}
            activeTheme={activeTheme}
            allNodes={nodes}
          />
        )}
      </div>
    </div>
  )
}
