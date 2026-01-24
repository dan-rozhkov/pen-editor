import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { useVariableStore } from '../store/variableStore'
import { generateVariableId } from '../types/variable'
import type { Variable } from '../types/variable'

// Plus icon for Add button
const PlusIcon = () => (
  <svg viewBox="0 0 16 16" className="w-4 h-4 text-text-muted">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

// Trash icon for Delete button
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5">
    <path
      d="M4 4h8M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 6v6M8 6v6M10 6v6M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
)

interface VariableItemProps {
  variable: Variable
  isSelected: boolean
  onSelect: (id: string) => void
}

function VariableItem({ variable, isSelected, onSelect }: VariableItemProps) {
  const updateVariable = useVariableStore((s) => s.updateVariable)
  const deleteVariable = useVariableStore((s) => s.deleteVariable)
  const [isHovered, setIsHovered] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState(variable.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteVariable(variable.id)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(variable.name)
    setIsEditingName(true)
  }

  const handleNameSubmit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== variable.name) {
      updateVariable(variable.id, { name: trimmed })
    }
    setIsEditingName(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingName(false)
      setEditName(variable.name)
    }
  }

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateVariable(variable.id, { value: e.target.value })
  }

  return (
    <div
      className={clsx(
        'flex items-center justify-between py-1.5 px-3 cursor-pointer transition-colors duration-100',
        isSelected ? 'bg-accent-primary hover:bg-accent-hover' : 'hover:bg-surface-elevated'
      )}
      onClick={() => onSelect(variable.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Color swatch with native color picker */}
        <label className="relative w-5 h-5 shrink-0 cursor-pointer">
          <div
            className="w-5 h-5 rounded border border-border-light"
            style={{ backgroundColor: variable.value }}
          />
          <input
            type="color"
            value={variable.value}
            onChange={handleColorChange}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>

        {/* Variable name (editable on double-click) */}
        {isEditingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface-elevated border border-accent-bright rounded px-1 py-0.5 text-xs text-text-primary outline-none"
          />
        ) : (
          <span
            className={clsx(
              'text-xs whitespace-nowrap overflow-hidden text-ellipsis',
              isSelected ? 'text-white' : 'text-text-secondary'
            )}
            onDoubleClick={handleDoubleClick}
          >
            {variable.name}
          </span>
        )}
      </div>

      {/* Delete button (visible on hover) */}
      {isHovered && !isEditingName && (
        <button
          className="bg-transparent border-none cursor-pointer p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors"
          onClick={handleDelete}
          title="Delete variable"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  )
}

export function VariablesPanel() {
  const variables = useVariableStore((s) => s.variables)
  const addVariable = useVariableStore((s) => s.addVariable)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleAddVariable = () => {
    const newVar: Variable = {
      id: generateVariableId(),
      name: `Color ${variables.length + 1}`,
      type: 'color',
      value: '#4a90d9',
    }
    addVariable(newVar)
    setSelectedId(newVar.id)
  }

  return (
    <div className="h-[200px] shrink-0 bg-surface-panel border-b border-border-default flex flex-col select-none">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-border-default">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white uppercase tracking-wide">Variables</span>
          <span className="bg-border-default text-text-muted px-1.5 py-0.5 rounded text-[10px] font-medium">
            {variables.length}
          </span>
        </div>
        <button
          className="bg-transparent border-none cursor-pointer p-1 rounded hover:bg-surface-elevated transition-colors"
          onClick={handleAddVariable}
          title="Add variable"
        >
          <PlusIcon />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {variables.length === 0 ? (
          <div className="text-text-disabled text-xs text-center p-5">No variables yet</div>
        ) : (
          variables.map((variable) => (
            <VariableItem
              key={variable.id}
              variable={variable}
              isSelected={selectedId === variable.id}
              onSelect={setSelectedId}
            />
          ))
        )}
      </div>
    </div>
  )
}
