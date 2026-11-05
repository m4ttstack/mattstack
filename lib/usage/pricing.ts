export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

interface Rate {
  input: number;
  output: number;
  cacheReadMult: number;
}

// USD per million tokens, confirmed 2026-11-04 against platform.claude.com/docs/en/about-claude/pricing.
const RATES: Record<string, Rate> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheReadMult: 0.025 },
  "claude-fable-5": { input: 10, output: 50, cacheReadMult: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheReadMult: 0.05 },
  "claude-opus-5": { input: 5, output: 25, cacheReadMult: 0.1 },
  "claude-opus-4-8": { input: 5, output: 25, cacheReadMult: 0.1 },
  "claude-opus-4-7": { input: 5, output: 25, cacheReadMult: 0.1 },
  "claude-opus-4-6": { input: 5, output: 25, cacheReadMult: 0.1 },
  "claude-opus-4-5": { input: 5, output: 25, cacheReadMult: 0.1 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheReadMult: 0.05 },
  "claude-sonnet-5": { input: 2, output: 10, cacheReadMult: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheReadMult: 0.1 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheReadMult: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheReadMult: 0.1 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheReadMult: 0.1 },
};

// Priced per request on its prompt length, cache tokens included.
const HAIKU_5_5_LONG: Rate = { input: 0.5, output: 2.5, cacheReadMult: 0.1 };
const HAIKU_5_5_THRESHOLD = 100_000;

// Fast mode doubles every rate, cache rates included (they stack on the fast input price).
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);

export function costOf(model: string, tokens: TokenTotals, speed: string | null): number | null {
  const id = model.replace(/-\d{8}$/, "");
  let rate = RATES[id];
  if (!rate) return null;
  if (id === "claude-haiku-5-5") {
    const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;
    if (prompt > HAIKU_5_5_THRESHOLD) rate = HAIKU_5_5_LONG;
  }
  const fast = speed === "fast" && FAST_MODELS.has(id) ? 2 : 1;
  const input = rate.input * fast;
  const output = rate.output * fast;
  return (
    (tokens.input * input +
      tokens.output * output +
      tokens.cacheRead * input * rate.cacheReadMult +
      tokens.cacheWrite5m * input * 1.25 +
      tokens.cacheWrite1h * input * 2) /
    1_000_000
  );
}
