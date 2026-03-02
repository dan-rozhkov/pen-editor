import { useRef, useEffect, useCallback } from 'react'
import type { EmbedNode } from '../types/scene'
import { useSceneStore, createSnapshot } from '../store/sceneStore'
import { useHistoryStore } from '../store/historyStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'

/** Tags that should never be made contenteditable */
const SKIP_TAGS = new Set([
  'STYLE','SCRIPT','SVG','CANVAS','VIDEO','AUDIO','IFRAME',
  'IMG','INPUT','TEXTAREA','SELECT','BR','HR','META','LINK',
])

/**
 * Determine if an element is a "text leaf" — it contains meaningful
 * direct text content and no block-level child elements.
 * This catches <div>, <span>, <p>, <h1>, <button>, <td>, etc.
 */
function isTextLeaf(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false
  // Must have some non-whitespace text content
  let hasText = false
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      hasText = true
    }
  }
  if (!hasText) return false
  // No child elements that themselves contain text (i.e., this is the deepest text container)
  for (const child of el.children) {
    if (SKIP_TAGS.has(child.tagName)) continue
    if (child.textContent?.trim()) return false
  }
  return true
}

/** Check if an element has an ancestor that is already contenteditable */
function hasEditableAncestor(el: Element, root: Element): boolean {
  let cur = el.parentElement
  while (cur && cur !== root) {
    if (cur.hasAttribute('contenteditable')) return true
    cur = cur.parentElement
  }
  return false
}

/** Serialize container innerHTML, stripping editing artifacts */
function serializeContainer(container: HTMLDivElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })
  return clone.innerHTML
}

interface InlineEmbedEditorProps {
  node: EmbedNode
  absoluteX: number
  absoluteY: number
}

export function InlineEmbedEditor({
  node,
  absoluteX,
  absoluteY,
}: InlineEmbedEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const shadowRootRef = useRef<ShadowRoot | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const htmlContentRef = useRef(node.htmlContent)
  const nodeIdRef = useRef(node.id)
  const committedRef = useRef(false)

  const scale = useViewportStore((s) => s.scale)
  const panX = useViewportStore((s) => s.x)
  const panY = useViewportStore((s) => s.y)

  // Screen position from world coordinates
  const dpr = window.devicePixelRatio || 1
  const screenX = Math.round((absoluteX * scale + panX) * dpr) / dpr
  const screenY = Math.round((absoluteY * scale + panY) * dpr) / dpr

  // Keep refs in sync
  useEffect(() => { htmlContentRef.current = node.htmlContent }, [node.htmlContent])
  useEffect(() => { nodeIdRef.current = node.id }, [node.id])

  /** Commit edited HTML to the store. Idempotent via committedRef. */
  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const container = containerRef.current
    if (!container) return
    const newHtml = serializeContainer(container)
    if (newHtml !== htmlContentRef.current) {
      useSceneStore.getState().updateNodeWithoutHistory(
        nodeIdRef.current,
        { htmlContent: newHtml },
      )
    }
  }, [])

  const commitAndExit = useCallback(() => {
    commit()
    useSelectionStore.getState().stopEditing()
  }, [commit])

  // Save history snapshot on mount, set up shadow DOM.
  // On unmount, commit any pending edits (covers click-outside, programmatic unmount, etc.)
  useEffect(() => {
    // Reset committedRef on (re-)mount to handle React strict mode double-mount
    committedRef.current = false

    useHistoryStore
      .getState()
      .saveHistory(createSnapshot(useSceneStore.getState()))

    const host = hostRef.current
    if (!host) return

    const currentScale = useViewportStore.getState().scale

    // Attach shadow DOM for style isolation (reuse existing on strict-mode remount)
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    shadow.innerHTML = ''
    shadowRootRef.current = shadow

    // Add a style to hide outlines on contenteditable elements
    const style = document.createElement('style')
    style.textContent = '[contenteditable] { outline: none; cursor: text; }'
    shadow.appendChild(style)

    // Container renders content at natural size, scaled via CSS transform
    const container = document.createElement('div')
    container.style.outline = 'none'
    container.style.width = `${node.width}px`
    container.style.height = `${node.height}px`
    container.style.overflow = 'hidden'
    container.style.transform = `scale(${currentScale})`
    container.style.transformOrigin = 'top left'
    container.innerHTML = node.htmlContent
    shadow.appendChild(container)
    containerRef.current = container

    // Make "text leaf" elements editable — elements that contain direct
    // text content without block-level children containing text.
    // Skip elements that already have an editable ancestor to avoid
    // nested contenteditable which causes content duplication.
    const editableEls: HTMLElement[] = []
    container.querySelectorAll('*').forEach((el) => {
      if (isTextLeaf(el) && !hasEditableAncestor(el, container)) {
        ;(el as HTMLElement).setAttribute('contenteditable', 'true')
        editableEls.push(el as HTMLElement)
      }
    })

    // Focus the first editable element, or the container itself as fallback
    const firstEditable = editableEls[0]
    if (firstEditable) {
      firstEditable.focus()
    } else {
      container.setAttribute('contenteditable', 'true')
      container.focus()
    }

    return () => {
      // Commit on unmount — handles click-outside and any other unmount path
      commit()
      containerRef.current = null
      shadowRootRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep shadow DOM container scale in sync with viewport zoom
  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.style.transform = `scale(${scale})`
    }
  }, [scale])

  // Key handling and focus management
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        commitAndExit()
        return
      }

      // Keep canvas shortcuts isolated while editing embed text,
      // but let Cmd/Ctrl combinations bubble for clipboard shortcuts.
      if (!e.metaKey && !e.ctrlKey) {
        e.stopPropagation()
      }
    }

    // Detect when focus truly leaves the editor.
    // Shadow DOM retargets relatedTarget across boundaries, so we use
    // focusout + setTimeout / focusin cancel pattern.
    let pendingExit: ReturnType<typeof setTimeout> | null = null

    const handleFocusOut = () => {
      pendingExit = setTimeout(() => {
        pendingExit = null
        commitAndExit()
      }, 0)
    }

    const handleFocusIn = () => {
      if (pendingExit != null) {
        clearTimeout(pendingExit)
        pendingExit = null
      }
    }

    host.addEventListener('keydown', handleKeyDown, true)
    host.addEventListener('focusout', handleFocusOut, true)
    host.addEventListener('focusin', handleFocusIn, true)
    return () => {
      if (pendingExit != null) clearTimeout(pendingExit)
      host.removeEventListener('keydown', handleKeyDown, true)
      host.removeEventListener('focusout', handleFocusOut, true)
      host.removeEventListener('focusin', handleFocusIn, true)
    }
  }, [commitAndExit])

  return (
    <div
      ref={hostRef}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: node.width * scale,
        height: node.height * scale,
        overflow: 'hidden',
        outline: '2px solid #0d99ff',
        outlineOffset: 0,
        zIndex: 100,
        cursor: 'text',
      }}
    />
  )
}
