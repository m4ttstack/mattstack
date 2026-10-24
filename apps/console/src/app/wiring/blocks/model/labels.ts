/** An exit label up to its first colon: `no: redo with their note` reads `no`. */
export function cutLabel(label: string): string {
  return label.split(':', 1)[0]!.trim();
}
