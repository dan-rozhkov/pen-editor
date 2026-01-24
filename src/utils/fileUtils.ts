import type { SceneNode } from '../types/scene'
import type { Variable } from '../types/variable'

export interface PenDocument {
  version: string
  nodes: SceneNode[]
  variables?: Variable[]
}

export interface DocumentData {
  nodes: SceneNode[]
  variables: Variable[]
}

const CURRENT_VERSION = '1.0'

export function serializeDocument(nodes: SceneNode[], variables: Variable[]): string {
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    nodes,
    variables,
  }
  return JSON.stringify(doc, null, 2)
}

export function deserializeDocument(json: string): DocumentData {
  const doc: PenDocument = JSON.parse(json)
  // Future: handle version migrations here
  return {
    nodes: doc.nodes,
    variables: doc.variables ?? [],
  }
}

export function downloadDocument(nodes: SceneNode[], variables: Variable[], filename = 'document.json') {
  const json = serializeDocument(nodes, variables)
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
