import { create } from 'zustand'

export interface DropIndicatorData {
  x: number
  y: number
  length: number
  direction: 'horizontal' | 'vertical'
}

export interface InsertInfo {
  parentId: string
  index: number
}

interface DragState {
  isDragging: boolean
  draggedNodeId: string | null
  dropIndicator: DropIndicatorData | null
  insertInfo: InsertInfo | null
  isOutsideParent: boolean

  startDrag: (nodeId: string) => void
  updateDrop: (indicator: DropIndicatorData | null, insertInfo: InsertInfo | null, isOutsideParent?: boolean) => void
  endDrag: () => void
}

export const useDragStore = create<DragState>((set) => ({
  isDragging: false,
  draggedNodeId: null,
  dropIndicator: null,
  insertInfo: null,
  isOutsideParent: false,

  startDrag: (nodeId) =>
    set({
      isDragging: true,
      draggedNodeId: nodeId,
      dropIndicator: null,
      insertInfo: null,
      isOutsideParent: false,
    }),

  updateDrop: (indicator, insertInfo, isOutsideParent = false) =>
    set({
      dropIndicator: indicator,
      insertInfo,
      isOutsideParent,
    }),

  endDrag: () =>
    set({
      isDragging: false,
      draggedNodeId: null,
      dropIndicator: null,
      insertInfo: null,
      isOutsideParent: false,
    }),
}))
