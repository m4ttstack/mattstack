/**
 * JSONC → JSON: strip comments and trailing commas so the result parses
 * with JSON.parse. String-aware (a real scanner, not regexes), so `//`
 * inside a string value — e.g. an origin URL like "https://gitlab.com/…" —
 * is content, never a comment. Single definition for every .jsonc rt reads
 * (sdm enrichment, ~/.mattstack/rt/repos overlay files).
 */

export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i]!;

    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Trailing comma: the last significant char emitted before a closer is
    // dropped here rather than by a regex pass, which a comma inside a
    // string would fool.
    if (ch === "}" || ch === "]") {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j]!)) j--;
      if (j >= 0 && out[j] === ",") out = out.slice(0, j) + out.slice(j + 1);
    }

    out += ch;
    i++;
  }

  return out;
}

export type JsoncPos = { line: number; col: number };

/** `key` is null for an array element. */
export type JsoncSite = { key: JsoncPos | null; value: JsoncPos };

/**
 * Where each member sits in the source, keyed by `JSON.stringify(path)`
 * (object keys as strings, array indexes as numbers), so a diagnostic about a
 * parsed value can name its line and column. Text that does not scan as JSONC
 * ends the walk with the sites found so far: callers parse the same text with
 * `JSON.parse` first and report its errors there.
 */
export function jsoncSites(text: string): Map<string, JsoncSite> {
  const sites = new Map<string, JsoncSite>();
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const pos = (): JsoncPos => ({ line, col: i - lineStart + 1 });
  const step = () => {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
    i++;
  };
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i]!)) step();
      else if (text.startsWith("//", i)) while (i < text.length && text[i] !== "\n") step();
      else if (text.startsWith("/*", i)) {
        while (i < text.length && !text.startsWith("*/", i)) step();
        step();
        step();
      } else return;
    }
  };
  const readString = (): string => {
    const start = i;
    step();
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") step();
      step();
    }
    step();
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: (string | number)[], key: JsoncPos | null): void => {
    skip();
    sites.set(JSON.stringify(path), { key, value: pos() });
    const open = text[i];
    if (open === '"') return void readString();
    if (open !== "{" && open !== "[") {
      const start = i;
      while (i < text.length && !/[\s,\]}/]/.test(text[i]!)) step();
      if (i === start) throw new SyntaxError("expected a value");
      return;
    }
    const close = open === "{" ? "}" : "]";
    step();
    for (let index = 0; ; index++) {
      skip();
      if (i >= text.length) return;
      if (text[i] === close) return void step();
      if (open === "{") {
        if (text[i] !== '"') throw new SyntaxError("expected a key");
        const at = pos();
        const name = readString();
        skip();
        if (text[i] !== ":") throw new SyntaxError("expected a colon");
        step();
        value([...path, name], at);
      } else value([...path, index], null);
      skip();
      if (text[i] === ",") step();
    }
  };
  try {
    value([], null);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }
  return sites;
}
