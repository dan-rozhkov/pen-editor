import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
import { generateVariableId, getVariableValue } from '../types/variable'
import type { Variable, ThemeName } from '../types/variable'

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

// Sun icon for light theme
const SunIcon = () => (
  <svg viewBox="0 0 16 16" className="w-3 h-3">
    <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

// Moon icon for dark theme
const MoonIcon = () => (
  <svg viewBox="0 0 16 16" className="w-3 h-3">
    <path
      d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Theme toggle component
function ThemeToggle() {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme)

  return (
    <div className="flex border border-border-light rounded overflow-hidden">
      <button
        className={clsx(
          'px-1.5 py-0.5 transition-colors',
          activeTheme === 'light'
            ? 'bg-white text-gray-900'
            : 'bg-surface-elevated text-text-muted hover:bg-surface-hover'
        )}
        onClick={() => setActiveTheme('light')}
        title="Light theme"
      >
        <SunIcon />
      </button>
      <button
        className={clsx(
          'px-1.5 py-0.5 transition-colors',
          activeTheme === 'dark'
            ? 'bg-gray-700 text-white'
            : 'bg-surface-elevated text-text-muted hover:bg-surface-hover'
        )}
        onClick={() => setActiveTheme('dark')}
        title="Dark theme"
      >
        <MoonIcon />
      </button>
    </div>
  )
}

interface VariableItemProps {
  variable: Variable
  isSelected: boolean
  onSelect: (id: string) => void
}

function VariableItem({ variable, isSelected, onSelect }: VariableItemProps) {
  const updateVariable = useVariableStore((s) => s.updateVariable)
  const updateVariableThemeValue = useVariableStore((s) => s.updateVariableThemeValue)
  const deleteVariable = useVariableStore((s) => s.deleteVariable)
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const [isHovered, setIsHovered] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState(variable.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const lightValue = getVariableValue(variable, 'light')
  const darkValue = getVariableValue(variable, 'dark')

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

  const handleColorChange = (theme: ThemeName, value: string) => {
    updateVariableThemeValue(variable.id, theme, value)
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
        {/* Dual color swatches (light | dark) */}
        <div className="flex rounded overflow-hidden border border-border-light shrink-0">
          {/* Light theme swatch */}
          <label
            className={clsx(
              'relative w-4 h-5 cursor-pointer',
              activeTheme === 'light' && 'ring-1 ring-inset ring-accent-bright'
            )}
            title="Light theme value"
          >
            <div
              className="w-full h-full"
              style={{ backgroundColor: lightValue }}
            />
            <input
              type="color"
              value={lightValue}
              onChange={(e) => handleColorChange('light', e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </label>
          {/* Dark theme swatch */}
          <label
            className={clsx(
              'relative w-4 h-5 cursor-pointer border-l border-border-light',
              activeTheme === 'dark' && 'ring-1 ring-inset ring-accent-bright'
            )}
            title="Dark theme value"
          >
            <div
              className="w-full h-full"
              style={{ backgroundColor: darkValue }}
            />
            <input
              type="color"
              value={darkValue}
              onChange={(e) => handleColorChange('dark', e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </label>
        </div>

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
    const defaultColor = '#4a90d9'
    const newVar: Variable = {
      id: generateVariableId(),
      name: `Color ${variables.length + 1}`,
      type: 'color',
      value: defaultColor,
      themeValues: {
        light: defaultColor,
        dark: defaultColor,
      },
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
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            className="bg-transparent border-none cursor-pointer p-1 rounded hover:bg-surface-elevated transition-colors"
            onClick={handleAddVariable}
            title="Add variable"
          >
            <PlusIcon />
          </button>
        </div>
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
