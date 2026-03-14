import type { ComponentArtifact, SceneNode } from '../types/scene'
import type { Variable, ThemeName } from '../types/variable'
import { ensureThemeValues } from '../types/variable'
import { generateId } from '../types/scene'
import { serializePublicPenDocument } from "@/utils/publicPenExport";

export interface PenPage {
  id: string
  name: string
  nodes: SceneNode[]
  pageBackground?: string
}

export interface PenDocument {
  version: string
  // Legacy single-page format
  nodes?: SceneNode[]
  // Multi-page format
  pages?: PenPage[]
  variables?: Variable[]
  activeTheme?: ThemeName
  componentArtifacts?: Record<string, ComponentArtifact>
}

export interface DocumentPageData {
  id: string
  name: string
  nodes: SceneNode[]
  pageBackground: string
}

export interface DocumentData {
  pages: DocumentPageData[]
  variables: Variable[]
  activeTheme: ThemeName
  componentArtifacts: Record<string, ComponentArtifact>
}

const CURRENT_VERSION = '1.1'

export function serializeDocument(
  pages: { id: string; name: string; nodes: SceneNode[]; pageBackground: string }[],
  variables: Variable[],
  activeTheme: ThemeName,
  componentArtifacts: Record<string, ComponentArtifact> = {},
): string {
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      nodes: p.nodes,
      ...(p.pageBackground !== '#f5f5f5' ? { pageBackground: p.pageBackground } : {}),
    })),
    variables,
    activeTheme,
    componentArtifacts,
  }
  return JSON.stringify(doc, null, 2)
}

export function deserializeDocument(json: string): DocumentData {
  const doc: PenDocument = JSON.parse(json)
  const migratedVariables = (doc.variables ?? []).map(ensureThemeValues)

  let pages: DocumentPageData[]
  if (doc.pages && doc.pages.length > 0) {
    // Multi-page format
    pages = doc.pages.map((p) => ({
      id: p.id,
      name: p.name,
      nodes: p.nodes,
      pageBackground: p.pageBackground ?? '#f5f5f5',
    }))
  } else {
    // Legacy single-page: wrap in a single page
    pages = [{
      id: generateId(),
      name: 'Page 1',
      nodes: doc.nodes ?? [],
      pageBackground: '#f5f5f5',
    }]
  }

  return {
    pages,
    variables: migratedVariables,
    activeTheme: doc.activeTheme ?? 'light',
    componentArtifacts: doc.componentArtifacts ?? {},
  }
}

export function downloadDocument(
  pages: { id: string; name: string; nodes: SceneNode[]; pageBackground: string }[],
  variables: Variable[],
  activeTheme: ThemeName,
  componentArtifacts: Record<string, ComponentArtifact> = {},
  filename = 'document.json'
) {
  const json = serializeDocument(pages, variables, activeTheme, componentArtifacts)
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
