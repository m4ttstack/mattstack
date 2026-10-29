/** A link's destination never renders as text, so a rendered character
    must not match inside one. */
function linkDestinations(source: string): boolean[] {
  const hidden = new Array<boolean>(source.length).fill(false);
  for (const m of source.matchAll(/\]\(([^)]*)\)/g))
    for (let i = m.index; i < m.index + m[0].length; i++) hidden[i] = true;
  return hidden;
}

/** Where a caret at `offset` in `rendered` (the Markdown as it reads) sits
    in `source`: the rendered characters before it, whitespace aside, are
    matched in order through the source, so markers the render dropped
    (`**`, backticks, link syntax) fall behind the caret. A click past the
    rendered text, or text the source cannot match, lands at the end. */
export function sourceOffset(
  source: string,
  rendered: string,
  offset: number
): number {
  if (offset >= rendered.length) return source.length;
  const hidden = linkDestinations(source);
  const before = rendered.slice(0, Math.max(0, offset));
  let at = 0;
  for (const ch of before) {
    if (/\s/.test(ch)) continue;
    while (at < source.length && (hidden[at] || source[at] !== ch)) at++;
    if (at >= source.length) return source.length;
    at++;
  }
  const trailing = before.length - before.trimEnd().length;
  for (let n = 0; n < trailing && /\s/.test(source[at] ?? ''); n++) at++;
  return at;
}
