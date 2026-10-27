/** A skill's description in two parts: what it is for, and the phrases a
    person would say to call it. */
export type SkillDescription = { purpose: string; asks: string[] };

const SPLIT = ' -- ';
const QUOTED = /['‘’]([^'‘’]+)['‘’]/g;

/** Splits rt's "Use when X -- 'a', 'b', or Y." into its purpose ("Use
    when X, or Y.") and its quoted phrases. Any other shape, or one whose
    quotes do not pair up, comes back whole with no phrases, so no text is
    ever dropped. */
export function splitDescription(description: string): SkillDescription {
  const whole = { purpose: description, asks: [] };
  const at = description.indexOf(SPLIT);
  if (at < 0) return whole;
  const head = description.slice(0, at).trim();
  const rest = description.slice(at + SPLIT.length);
  if ((rest.match(/['‘’]/g) ?? []).length % 2 !== 0) return whole;
  const asks = [...rest.matchAll(QUOTED)].map(match => match[1]!.trim());
  if (asks.length === 0) return whole;
  const between = rest.replace(QUOTED, '').split(/,\s*/);
  const tail = between
    .pop()!
    .trim()
    .replace(/^--\s*/, '')
    .replace(/\.$/, '');
  if (between.some(part => part.trim() !== '')) return whole;
  const purpose = tail ? `${head}, ${tail}` : head;
  return { purpose: `${purpose.replace(/\.$/, '')}.`, asks };
}
