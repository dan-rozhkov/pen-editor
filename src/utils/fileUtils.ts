import type { ComponentArtifact, SceneNode } from '../types/scene'
import type { Variable, ThemeName } from '../types/variable'
import { ensureThemeValues } from '../types/variable'
import { serializePublicPenDocument } from "@/utils/publicPenExport";

export interface PenDocument {
  version: string
  nodes: SceneNode[]
  variables?: Variable[]
  activeTheme?: ThemeName
  componentArtifacts?: Record<string, ComponentArtifact>
}

export interface DocumentData {
  nodes: SceneNode[]
  variables: Variable[]
  activeTheme: ThemeName
  componentArtifacts: Record<string, ComponentArtifact>
}

const CURRENT_VERSION = '1.0'

export function serializeDocument(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName,
  componentArtifacts: Record<string, ComponentArtifact> = {},
): string {
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    nodes,
    variables,
    activeTheme,
    componentArtifacts,
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
    activeTheme: doc.activeTheme ?? 'light',
    componentArtifacts: doc.componentArtifacts ?? {},
  }
}

export function downloadDocument(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName,
  componentArtifacts: Record<string, ComponentArtifact> = {},
  filename = 'document.json'
) {
  const json = serializeDocument(nodes, variables, activeTheme, componentArtifacts)
  downloadTextFile(json, filename)
}

export function downloadPublicPen(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName,
  filename = "document.pen"
) {
  const json = serializePublicPenDocument(nodes, variables, activeTheme)
  downloadTextFile(json, filename)
}

function downloadTextFile(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export interface OpenFileResult extends DocumentData {
  fileName: string;
}

export function openFilePicker(): Promise<OpenFileResult> {
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
        resolve({ ...data, fileName: file.name })
      } catch (err) {
        reject(err)
      }
    }

    input.click()
  })
}
