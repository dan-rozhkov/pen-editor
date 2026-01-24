export interface BaseNode {
  id: string
  type: 'frame' | 'rect' | 'ellipse' | 'text'
  x: number
  y: number
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}

export interface FrameNode extends BaseNode {
  type: 'frame'
  children: SceneNode[]
  cornerRadius?: number
}

export interface RectNode extends BaseNode {
  type: 'rect'
  cornerRadius?: number
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse'
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  fontSize?: number
  fontFamily?: string
}

export type SceneNode = FrameNode | RectNode | EllipseNode | TextNode

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}
