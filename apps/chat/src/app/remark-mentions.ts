import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

export interface MentionOptions {
  /** The message's own `mentions` ids: the only identities that count. */
  handles: string[];
  /** Display names parallel to `handles`; the body text carries these. */
  names?: string[];
  /** The human's id: its mention gets `meClassName` and `data-me`. */
  me?: string;
  className: string;
  meClassName: string;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `@handle` -> a span, only for handles the message lists. Runs on text
 * nodes after remark has parsed the body, so an `@` inside a code span,
 * a fence or a link label is never reached. The `hName`/`hProperties`
 * data is what mdast-util-to-hast turns into the element.
 */
export function remarkMentions(options: MentionOptions) {
  const { handles, names, me, className, meClassName } = options;
  if (handles.length === 0) return () => {};
  const idBySpelling = new Map<string, string>();
  handles.forEach((id, i) => {
    const shown = names?.[i] ?? id;
    if (!idBySpelling.has(shown)) idBySpelling.set(shown, id);
    // An agent quoting a delivery-frame reply hint spells the id directly
    // (`@remy.m2p4`), even when the body also carries a display name for
    // the same id; both spellings must resolve.
    if (!idBySpelling.has(id)) idBySpelling.set(id, id);
  });
  const pattern = new RegExp(
    `@(${[...idBySpelling.keys()].map(escapeForRegExp).join('|')})(?![a-z0-9._-])`,
    'g'
  );
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') return;
      const parts: Text[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) {
          parts.push({
            type: 'text',
            value: node.value.slice(last, match.index),
          });
        }
        const shown = match[1]!;
        const id = idBySpelling.get(shown)!;
        const isMe = id === me;
        parts.push({
          type: 'text',
          value: `@${shown}`,
          data: {
            hName: 'span',
            hProperties: {
              className: isMe ? [className, meClassName] : [className],
              'data-mention': id,
              ...(isMe ? { 'data-me': 'true' } : {}),
            },
          },
        });
        last = pattern.lastIndex;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(last) });
      }
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
