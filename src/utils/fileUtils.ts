import type { SceneNode } from '../types/scene'
import type { Variable, ThemeName, VariableCollection, ModeContext } from '../types/variable'
import { upgradeVariablesV2, withThemeOverrideMirror } from '../lib/variables'
import type { TextStyle } from '../types/textStyle'
import type { FillStyle, EffectStyle } from '../types/style'
import type { DesignSystemScope } from '../types/designSystemScope'
import { sanitizeDesignSystemScopes } from '../lib/designSystem/savedScopes'
import { generateId } from '../types/scene'
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import { saveBlob } from "@/lib/downloadFile";
import type { Guide } from "@/store/guidesStore";
import type { PersistedMeasurement } from "@/store/measurementsStore";
import type { CommentThread } from "@/store/commentsStore";
import type { LibraryAuthor, LibraryPin } from "@/lib/designSystem/types";
import { isRecord } from '@/lib/utils'

/**
 * File-level design-system library state (v1.3+). All optional: a file without
 * it is a plain document. Library-owned variables, collections and component
 * masters carry their own `libraryId` / `component.library` flags inside the
 * document; this holds the document's identity and what it is linked to.
 */
export interface DocumentLibraryMeta {
  /** Random id of the document; minted on first save or open. */
  documentId?: string
  /** Libraries this document is linked to. */
  libraries?: LibraryPin[]
  /** Set when this document authors a library. */
  libraryAuthor?: LibraryAuthor
}

export interface PenPage {
  id: string
  name: string
  nodes: SceneNode[]
  pageBackground?: string
  guides?: Guide[]
  /** Persistent slide (presentation) order — see src/utils/slideOrder.ts */
  slideOrder?: string[]
  measurements?: PersistedMeasurement[]
  /** Canvas comment threads (cmt-01). Omitted when empty. */
  comments?: CommentThread[]
}

export interface PenDocument extends DocumentLibraryMeta {
  version: string
  // Legacy single-page format
  nodes?: SceneNode[]
  // Multi-page format
  pages?: PenPage[]
  variables?: Variable[]
  /** v1.2+: variable collections and their modes. Absent in older files (read as just Theme). */
  variableCollections?: VariableCollection[]
  textStyles?: TextStyle[]
  fillStyles?: FillStyle[]
  effectStyles?: EffectStyle[]
  activeTheme?: ThemeName
  /** v1.2+: the mode each collection was showing. Absent = `{ theme: activeTheme }`. */
  modeContext?: ModeContext
  /** Saved design-system scopes (`get_design_system` scope presets). Absent = none. */
  designSystemScopes?: DesignSystemScope[]
}

export interface DocumentPageData {
  id: string
  name: string
  nodes: SceneNode[]
  pageBackground: string
  guides: Guide[]
  slideOrder: string[]
  measurements: PersistedMeasurement[]
  comments: CommentThread[]
}

export interface DocumentData extends DocumentLibraryMeta {
  pages: DocumentPageData[]
  variables: Variable[]
  /** Optional so hand-built `DocumentData` (tests, tools) stays valid; absent = Theme only. */
  variableCollections?: VariableCollection[]
  textStyles: TextStyle[]
  fillStyles: FillStyle[]
  effectStyles: EffectStyle[]
  activeTheme: ThemeName
  modeContext?: ModeContext
  /** Optional so hand-built `DocumentData` stays valid; absent = none. */
  designSystemScopes?: DesignSystemScope[]
}

const CURRENT_VERSION = '1.3'

type PenPageInput = { id: string; name: string; nodes: SceneNode[]; pageBackground: string; guides?: Guide[]; slideOrder?: string[]; measurements?: PersistedMeasurement[]; comments?: CommentThread[] }

export function serializeDocument(
  pages: PenPageInput[],
  variables: Variable[],
  activeTheme: ThemeName,
  textStyles: TextStyle[] = [],
  fillStyles: FillStyle[] = [],
  effectStyles: EffectStyle[] = [],
  collections?: VariableCollection[],
  modeContext?: ModeContext,
  designSystemScopes?: DesignSystemScope[],
  library?: DocumentLibraryMeta,
): string {
  // Dual-write: each variable carries both the v2 fields and the legacy
  // `value`/`themeValues` mirrors, so an older build can still open the file.
  const upgraded = collections ? upgradeVariablesV2(variables, collections) : null
  const doc: PenDocument = {
    version: CURRENT_VERSION,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      // Dual-write frame mode picks: `modeOverrides` plus the `themeOverride` mirror.
      nodes: withThemeOverrideMirror(p.nodes),
      ...(p.pageBackground !== '#f5f5f5' ? { pageBackground: p.pageBackground } : {}),
      ...(p.guides && p.guides.length > 0 ? { guides: p.guides } : {}),
      ...(p.slideOrder && p.slideOrder.length > 0 ? { slideOrder: p.slideOrder } : {}),
      ...(p.measurements && p.measurements.length > 0 ? { measurements: p.measurements } : {}),
      ...(p.comments && p.comments.length > 0 ? { comments: p.comments } : {}),
    })),
    variables: upgraded ? upgraded.variables : variables,
    ...(upgraded ? { variableCollections: upgraded.collections } : {}),
    textStyles,
    fillStyles,
    effectStyles,
    activeTheme,
    ...(modeContext && Object.keys(modeContext).length > 0 ? { modeContext } : {}),
    ...(designSystemScopes && designSystemScopes.length > 0 ? { designSystemScopes } : {}),
    ...(library?.documentId ? { documentId: library.documentId } : {}),
    ...(library?.libraries && library.libraries.length > 0 ? { libraries: library.libraries } : {}),
    ...(library?.libraryAuthor ? { libraryAuthor: library.libraryAuthor } : {}),
  }
  return JSON.stringify(doc, null, 2)
}

/** `serializeDocument` over a collected `DocumentData` (autosave, share links): one place that knows every field. */
export function serializeDocumentData(doc: DocumentData, library: DocumentLibraryMeta = doc): string {
  return serializeDocument(
    doc.pages,
    doc.variables,
    doc.activeTheme,
    doc.textStyles,
    doc.fillStyles,
    doc.effectStyles,
    doc.variableCollections,
    doc.modeContext,
    doc.designSystemScopes,
    library,
  )
}

export function deserializeDocument(json: string): DocumentData {
  const doc: PenDocument = JSON.parse(json)
  const migrated = upgradeVariablesV2(doc.variables ?? [], doc.variableCollections)

  let pages: DocumentPageData[]
  if (doc.pages && doc.pages.length > 0) {
    // Multi-page format
    pages = doc.pages.map((p) => ({
      id: p.id,
      name: p.name,
      nodes: p.nodes,
      pageBackground: p.pageBackground ?? '#f5f5f5',
      guides: p.guides ?? [],
      slideOrder: p.slideOrder ?? [],
      measurements: p.measurements ?? [],
      comments: p.comments ?? [],
    }))
  } else {
    // Legacy single-page: wrap in a single page
    pages = [{
      id: generateId(),
      name: 'Page 1',
      nodes: doc.nodes ?? [],
      pageBackground: '#f5f5f5',
      guides: [],
      slideOrder: [],
      measurements: [],
      comments: [],
    }]
  }

  return {
    pages,
    variables: migrated.variables,
    variableCollections: migrated.collections,
    textStyles: doc.textStyles ?? [],
    fillStyles: doc.fillStyles ?? [],
    effectStyles: doc.effectStyles ?? [],
    activeTheme: doc.activeTheme ?? 'light',
    ...(doc.modeContext ? { modeContext: doc.modeContext } : {}),
    designSystemScopes: sanitizeDesignSystemScopes(doc.designSystemScopes),
    ...(typeof doc.documentId === 'string' && doc.documentId ? { documentId: doc.documentId } : {}),
    ...(Array.isArray(doc.libraries) ? { libraries: sanitizeLibraryPins(doc.libraries) } : {}),
    ...(isLibraryAuthor(doc.libraryAuthor) ? { libraryAuthor: doc.libraryAuthor } : {}),
  }
}

/** Keep well-formed pins only (a hand-edited or corrupt file must not break the load). */
function sanitizeLibraryPins(raw: unknown[]): LibraryPin[] {
  const out: LibraryPin[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    if (!isRecord(p) || typeof p.id !== 'string' || !p.id || typeof p.version !== 'string' || seen.has(p.id)) continue
    seen.add(p.id)
    out.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      version: p.version,
      ...(p.reportUsage === true ? { reportUsage: true } : {}),
      ...(typeof p.dismissedVersion === 'string' ? { dismissedVersion: p.dismissedVersion } : {}),
    })
  }
  return out
}

function isLibraryAuthor(x: unknown): x is LibraryAuthor {
  return isRecord(x) && typeof x.libraryId === 'string' && typeof x.name === 'string' &&
    (x.baseVersion === null || typeof x.baseVersion === 'string')
}

export function downloadDocument(
  pages: PenPageInput[],
  variables: Variable[],
  activeTheme: ThemeName,
  filename = 'document.json',
  textStyles: TextStyle[] = [],
  fillStyles: FillStyle[] = [],
  effectStyles: EffectStyle[] = [],
  collections?: VariableCollection[],
  modeContext?: ModeContext,
  designSystemScopes?: DesignSystemScope[],
  library?: DocumentLibraryMeta,
) {
  const json = serializeDocument(
    pages,
    variables,
    activeTheme,
    textStyles,
    fillStyles,
    effectStyles,
    collections,
    modeContext,
    designSystemScopes,
    library,
  )
  downloadTextFile(json, filename)
}

export function downloadPublicPen(
  nodes: SceneNode[],
  variables: Variable[],
  activeTheme: ThemeName,
  filename = "document.pen",
  collections?: VariableCollection[],
) {
  const json = serializePublicPenDocument(nodes, variables, activeTheme, collections)
  downloadTextFile(json, filename)
}

function downloadTextFile(text: string, filename: string) {
  saveBlob(new Blob([text], { type: 'application/json' }), filename)
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
