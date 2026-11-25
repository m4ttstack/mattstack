import type { OpenResult, SealBinding, SealedText, SealFields, SealResult } from "../sealed-text.ts";
import { canonicalHandle } from "../board-peers.ts";

interface Sealing {
  to: string[];
  binding: SealBinding;
  fields: SealFields;
}

/** One world's sealed text without `age`: like `age`, two seals of one text differ, and the string holds none of it. */
export function fakeSealedWorld(people: string[]) {
  const keyed = new Set(people);
  const all = new Map<string, Sealing>();
  const state = {
    /** What every seal answers instead. */
    seal: null as SealResult | null,
    /** What every open answers instead. */
    open: null as OpenResult | null,
    holds: true as boolean | Error,
    opened: 0,
  };

  function put(to: readonly string[], binding: SealBinding, fields: SealFields): string {
    const size = Math.ceil((Buffer.byteLength(JSON.stringify(fields)) * 4) / 3);
    const sealed = `${crypto.randomUUID()}${"A".repeat(size)}`;
    all.set(sealed, { to: to.map(canonicalHandle), binding: { ...binding, from: canonicalHandle(binding.from) }, fields });
    return sealed;
  }

  return {
    state,
    keyed,
    put,
    /** Every text sealed so far. */
    texts: (): string => JSON.stringify([...all.values()].map((s) => s.fields)),
    read: (sealed: string): SealFields | undefined => all.get(sealed)?.fields,
    forUser(me: string): SealedText {
      return {
        async seal(to, binding, fields) {
          if (state.seal) return state.seal;
          const handles = [...new Set(to.map(canonicalHandle))];
          const known = handles.filter((h) => keyed.has(h));
          if (known.length === 0) return { ok: false, reason: "no-recipients" };
          return { ok: true, sealed: put(known, binding, fields), unreachable: handles.filter((h) => !keyed.has(h)) };
        },
        async open(sealed, binding) {
          state.opened++;
          if (state.open) return state.open;
          const s = all.get(sealed);
          if (!s) return { ok: false, reason: "damaged" };
          if (!s.to.includes(canonicalHandle(me))) return { ok: false, reason: "not-for-this-key" };
          const same = s.binding.type === binding.type && s.binding.subject === binding.subject && s.binding.from === canonicalHandle(binding.from);
          return same ? { ok: true, fields: s.fields } : { ok: false, reason: "mismatch" };
        },
        async holdsKeyOf() {
          if (state.holds instanceof Error) throw state.holds;
          return state.holds;
        },
        reachable: () => [...keyed],
      };
    },
  };
}
