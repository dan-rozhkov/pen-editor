import type { SceneNode } from '../types/scene'
import type { Variable, ThemeName } from '../types/variable'
import { ensureThemeValues } from '../types/variable'

export interface PenDocument {
  version: string
  nodes: SceneNode[]
  variables?: Variable[]
  activeTheme?: ThemeName
}

export interface DocumentData {
  nodes: SceneNode[]
  variables: Variable[]
  activeTheme: ThemeName
}

const CURRENT_VERSION = '1.0'

export function serializeDocument(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName
): string {
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    nodes,
    variables,
    activeTheme,
  }
  return JSON.stringify(doc, null, 2)
}

export function deserializeDocument(json: string): DocumentData {
  const doc: PenDocument = JSON.parse(json)
  // Migrate variables to ensure theme values exist
  const migratedVariables = (doc.variables ?? []).map(ensureThemeValues)
  return {
    nodes: doc.nodes,
    variables: migratedVariables,
    activeTheme: doc.activeTheme ?? 'dark',
  }
}

export function downloadDocument(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName,
  filename = 'document.json'
) {
  const json = serializeDocument(nodes, variables, activeTheme)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function openFilePicker(): Promise<DocumentData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        reject(new Error('No file selected'))
        return
      }

      try {
        const text = await file.text()
        const data = deserializeDocument(text)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }

    input.click()
  })
}
