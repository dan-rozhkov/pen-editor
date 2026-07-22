// Component-property resolution: an instance supplies TEXT/BOOL/INSTANCE_SWAP
// values keyed by a prop-definition id; nodes inside the component master bind
// one of their own fields to that id via `componentPropRef`. Figma clipboard
// payloads never carry these fields, so every function here is a no-op on a
// plain Figma paste — this only activates for Pixso's (and Figma's own)
// component-property feature.

import {
  figGuidKey,
  type FigComponentPropDef,
  type FigComponentPropValue,
  type FigGUID,
  type FigNodeChange,
} from '../figTypes'

export type ComponentPropMap = Map<string, FigComponentPropValue>

// A defID of {sessionID:0, localID:0} is Figma/Pixso's "unset" sentinel and
// never resolves to a real prop definition.
function defKey(defID: FigGUID | undefined): string {
  if (!defID) return ''
  if (defID.sessionID === 0 && defID.localID === 0) return ''
  return figGuidKey(defID)
}

// A TEXT prop's value is usually a plain string, but Pixso's real payloads
// carry a full rich-text sub-message here (same shape as textData) so the
// bound text keeps its own style — accept either.
function textCharacters(textValue: FigComponentPropValue['textValue']): string | undefined {
  if (typeof textValue === 'string') return textValue
  return textValue?.characters
}

/**
 * Build the defID -> value map an instance supplies. Applied in this order,
 * each step overwriting a matching key from the step before:
 *   1. `masterPropDefs` (the instance's own master's `componentPropDef`
 *      declarations) — its `initialValue` seeds the default for any prop the
 *      instance itself never assigns. Most instances of a component never
 *      touch most of its props (e.g. an INSTANCE_SWAP icon slot left at its
 *      authored default), and the clipboard payload only ever carries an
 *      explicit `componentPropAssignment` for props a user actually changed
 *      — so without this default, an unassigned prop resolves to nothing
 *      and the bound field is left at the *slot's own* placeholder content
 *      instead of the component's real default.
 *   2. the inherited map (an enclosing instance's already-resolved props, so
 *      a nested instance still sees props forwarded from its parent).
 *   3. `change.componentPropAssignment` (the instance root).
 *   4. every `change.symbolData.symbolOverrides[].componentPropAssignment`,
 *      flat-merged across all override paths (path-scoping is a refinement;
 *      a flat merge recovers the bulk of real-world payloads per the design
 *      spec).
 */
export function buildComponentPropMap(
  change: FigNodeChange,
  inherited?: ComponentPropMap,
  masterPropDefs?: FigComponentPropDef[],
): ComponentPropMap {
  const map: ComponentPropMap = new Map()
  for (const def of masterPropDefs ?? []) {
    const key = defKey(def.id)
    if (!key || !def.initialValue) continue
    map.set(key, def.initialValue)
  }
  for (const [key, value] of inherited ?? []) map.set(key, value)
  const apply = (assignments: { defID?: FigGUID; value?: FigComponentPropValue }[] | undefined) => {
    for (const assignment of assignments ?? []) {
      const key = defKey(assignment.defID)
      if (!key || !assignment.value) continue
      map.set(key, assignment.value)
    }
  }
  apply(change.componentPropAssignment)
  for (const override of change.symbolData?.symbolOverrides ?? []) {
    apply(override.componentPropAssignment)
  }
  return map
}

/**
 * Resolve a node's `componentPropRef` bindings against the instance's prop
 * map, returning a change with the bound fields applied. Returns the input
 * unchanged (same reference) whenever there is nothing to resolve, so this
 * is a strict no-op for payloads without component properties.
 */
export function resolveComponentProps(
  change: FigNodeChange,
  props: ComponentPropMap | undefined,
): FigNodeChange {
  if (!props || !change.componentPropRef?.length) return change
  let result = change
  const ensureMutable = () => {
    if (result === change) result = { ...change }
    return result
  }
  for (const ref of change.componentPropRef) {
    const key = defKey(ref.defID)
    if (!key) continue
    const value = props.get(key)
    if (!value) continue
    switch (ref.componentPropNodeField) {
      case 'TEXT_DATA': {
        const characters = textCharacters(value.textValue)
        if (characters == null) break
        ensureMutable().textData = { ...result.textData, characters }
        break
      }
      case 'VISIBLE':
        if (value.boolValue == null) break
        ensureMutable().visible = value.boolValue
        break
      case 'OVERRIDDEN_SYMBOL_ID': {
        const swapTarget = value.guidValue
        // {0,0} is the unset sentinel — never a real swap target.
        if (!swapTarget || (swapTarget.sessionID === 0 && swapTarget.localID === 0)) break
        ensureMutable().overriddenSymbolID = swapTarget
        break
      }
      case 'INHERIT_FILL_STYLE_ID':
      default:
        break
    }
  }
  return result
}
