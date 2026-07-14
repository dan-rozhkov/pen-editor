export function getNodeDisplayName(node: { name?: string; type: string }): string {
  return node.name || node.type.charAt(0).toUpperCase() + node.type.slice(1);
}
