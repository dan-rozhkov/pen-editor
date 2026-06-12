import type { TextTransform } from '../types/scene'

/**
 * Apply CSS-style text transform to a string.
 * Visual only — original text is preserved in the node.
 */
export function applyTextTransform(text: string, transform?: TextTransform): string {
  switch (transform) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'capitalize': return text.replace(/\b(\p{L})/gu, char => char.toUpperCase())
    default: return text
  }
}
