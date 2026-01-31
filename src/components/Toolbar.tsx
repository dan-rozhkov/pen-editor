import { useState } from 'react'
import { useSceneStore } from '../store/sceneStore'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
import { downloadDocument, openFilePicker } from '../utils/fileUtils'
import { VariablesDialog } from './VariablesPanel'

const toolbarBtnClass = 'px-3 py-2 bg-surface-elevated border border-border-light rounded text-text-primary text-[13px] cursor-pointer transition-colors duration-150 hover:bg-surface-hover hover:border-border-hover active:bg-surface-active'

export function Toolbar() {
  const nodes = useSceneStore((state) => state.nodes)
  const setNodes = useSceneStore((state) => state.setNodes)
  const variables = useVariableStore((state) => state.variables)
  const setVariables = useVariableStore((state) => state.setVariables)
  const activeTheme = useThemeStore((state) => state.activeTheme)
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme)
  const [variablesOpen, setVariablesOpen] = useState(false)

  const handleSave = () => {
    downloadDocument(nodes, variables, activeTheme)
  }

  const handleOpen = async () => {
    try {
      const { nodes: loadedNodes, variables: loadedVariables, activeTheme: loadedTheme } = await openFilePicker()
      setNodes(loadedNodes)
      setVariables(loadedVariables)
      setActiveTheme(loadedTheme)
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }

  return (
    <div className="flex flex-row items-center gap-2 px-3 py-2 bg-surface-panel border-b border-border-default h-[44px]">
      <button className={toolbarBtnClass} onClick={handleOpen}>
        Open
      </button>
      <button className={toolbarBtnClass} onClick={handleSave}>
        Save
      </button>
      <button className={toolbarBtnClass} onClick={() => setVariablesOpen(true)}>
        Variables
      </button>
      <VariablesDialog open={variablesOpen} onOpenChange={setVariablesOpen} />
    </div>
  )
}
