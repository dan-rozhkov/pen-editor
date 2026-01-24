import type { SceneNode } from '../types/scene'

export interface PenDocument {
  version: string
  nodes: SceneNode[]
}

const CURRENT_VERSION = '1.0'

export function serializeDocument(nodes: SceneNode[]): string {
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    nodes,
  }
  return JSON.stringify(doc, null, 2)
}

export function deserializeDocument(json: string): SceneNode[] {
  const doc: PenDocument = JSON.parse(json)
  // Future: handle version migrations here
  return doc.nodes
}

export function downloadDocument(nodes: SceneNode[], filename = 'document.json') {
  const json = serializeDocument(nodes)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function openFilePicker(): Promise<SceneNode[]> {
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
        const nodes = deserializeDocument(text)
        resolve(nodes)
      } catch (err) {
        reject(err)
      }
    }

    input.click()
  })
}
