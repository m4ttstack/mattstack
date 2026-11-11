import type { DiffRefs, TextPosition } from './NoteMutator.ts';
import type { CommentAnchor } from './types.ts';

export function buildTextPosition(anchor: CommentAnchor, refs: DiffRefs): TextPosition {
  const old_path = anchor.oldPath ?? anchor.path;
  if (anchor.line === undefined) {
    if (anchor.oldLine === undefined) throw new Error('a comment anchor needs line or oldLine');
    return { ...refs, position_type: 'text', new_path: anchor.path, old_path, old_line: anchor.oldLine };
  }
  if (typeof anchor.oldLine === 'number') {
    return {
      ...refs,
      position_type: 'text',
      new_path: anchor.path,
      new_line: anchor.line,
      old_path,
      old_line: anchor.oldLine
    };
  }
  return { ...refs, position_type: 'text', new_path: anchor.path, new_line: anchor.line, old_path };
}
