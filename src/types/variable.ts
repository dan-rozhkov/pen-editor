export type VariableType = 'color'

export interface Variable {
  id: string
  name: string
  type: VariableType
  value: string // hex color "#RRGGBB"
}

export function generateVariableId(): string {
  return 'var_' + Math.random().toString(36).substring(2, 9)
}
