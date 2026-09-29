// A browser_run_code_unsafe function file: run it with
// { filename: <this file>, args: { rootSelector, nameAttr } }. run.js evals this
// same source, so it must stay one bare function expression with no imports.
async (page, { rootSelector, nameAttr }) =>
  page.evaluate(
    ({ rootSelector, nameAttr }) => {
      const root = document.querySelector(rootSelector);
      if (!root) throw new Error(`parity root not found: ${rootSelector}`);
      const rb = root.getBoundingClientRect();
      const r2 = v => Math.round(v * 100) / 100;
      const out = [];

      // Named descendants reached through unnamed wrappers count as direct children,
      // so a wrapper div in the app never changes a key.
      const namedKids = el => {
        const found = [];
        for (const k of el.children) {
          if (k.hasAttribute(nameAttr)) found.push(k);
          else found.push(...namedKids(k));
        }
        return found;
      };
      const hasNamedDescendant = el =>
        el.querySelector(`[${nameAttr}]`) !== null;

      const opacityOf = el => {
        let o = 1;
        for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
          o *= parseFloat(getComputedStyle(e).opacity);
        }
        return Math.round(o * 1000) / 1000;
      };
      const paints = c =>
        c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c);
      const strokeOf = cs => {
        for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
          if (
            parseFloat(cs[`border${s}Width`]) > 0 &&
            cs[`border${s}Style`] !== 'none'
          ) {
            return cs[`border${s}Color`];
          }
        }
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
          return cs.outlineColor;
        return null;
      };

      const record = (el, key, parent) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText ?? el.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const isText =
          tag !== 'svg' &&
          tag !== 'img' &&
          !hasNamedDescendant(el) &&
          text.length > 0;
        out.push({
          key,
          kind: isText ? 'text' : 'box',
          x: r2(b.x - rb.x),
          y: r2(b.y - rb.y),
          w: r2(b.width),
          h: r2(b.height),
          fill: paints(cs.backgroundColor) ? cs.backgroundColor : null,
          stroke: strokeOf(cs),
          color: isText ? cs.color : null,
          text: isText ? text : null,
          opacity: opacityOf(el),
          name: el.getAttribute(nameAttr),
          parent,
          tag,
        });
        return out.length - 1;
      };

      const walk = (el, prefix, parent) => {
        const kids = namedKids(el);
        const counts = {};
        for (const k of kids) {
          const n = k.getAttribute(nameAttr);
          counts[n] = (counts[n] || 0) + 1;
        }
        const seen = {};
        for (const k of kids) {
          const n = k.getAttribute(nameAttr);
          const idx =
            counts[n] > 1 ? `[${(seen[n] = (seen[n] ?? -1) + 1)}]` : '';
          const key = prefix ? `${prefix}/${n}${idx}` : `${n}${idx}`;
          walk(k, key, record(k, key, parent));
        }
      };

      walk(
        root,
        '',
        record(root, root.getAttribute(nameAttr) ?? rootSelector, -1)
      );
      return out;
    },
    { rootSelector, nameAttr }
  )
