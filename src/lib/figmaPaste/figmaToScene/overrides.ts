// Merging of Figma override changes (used by both text-style resolution and
// component-instance application).

import { figGuidKey, type FigNodeChange } from '../figTypes'

const OVERRIDE_EXCLUDED_KEYS = new Set(['guid', 'guidPath', 'parentIndex', 'type', 'phase', 'styleID'])

export function mergeChange(original: FigNodeChange, override: FigNodeChange): FigNodeChange {
  const merged: FigNodeChange = { ...original }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || OVERRIDE_EXCLUDED_KEYS.has(key)) continue
    ;(merged as Record<string, unknown>)[key] = value
  }
  return merged
}

export function buildOverrideMap(change: FigNodeChange): Map<string, FigNodeChange> {
  const map = new Map<string, FigNodeChange>()
  const collect = (overrides: FigNodeChange[] | undefined) => {
    for (const override of overrides ?? []) {
      const guids = override.guidPath?.guids
      if (!guids || guids.length === 0) continue
      const key = guids.map(figGuidKey).join('/')
      const existing = map.get(key)
      map.set(key, existing ? mergeChange(existing, override) : override)
    }
  }
  collect(change.symbolData?.symbolOverrides)
  collect(change.derivedSymbolData)
  return map
}
