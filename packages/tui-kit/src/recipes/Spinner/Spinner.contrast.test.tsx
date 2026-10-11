import { registerTheme, SoribashiProvider } from "@soribashi/core";
import {
  contrastRatio,
  installNoTransitionStyle,
  NO_TRANSITION_CLASS,
  resolveCanvasColor,
  toRgbString,
} from "@soribashi/core/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
// `/pure` for the same reason as Button.matrix.test.tsx: one mount shared by
// every case.
import { render } from "vitest-browser-react/pure";
import { CONTRAST_DEBT_BY_KEY, contrastDebtKey } from "../../a11y/known-contrast-debt.ts";
import { tuiTheme, tuiVocabulary } from "../../theme.ts";
import { Badge } from "../Badge/Badge.tsx";
import { Button } from "../Button/Button.tsx";
import { Spinner, SPINNER_PARTS } from "./Spinner.tsx";

registerTheme(tuiTheme);

/** WCAG 1.4.11: a graphic needs 3:1 against what it sits on. */
const MIN_GRAPHIC_CONTRAST = 3;
const BADGE_INTENTS = ["ok", "warn", "bad", "muted"] as const;
const SCHEMES = ["light", "dark"] as const;

interface Host {
  id: string;
  /** A busy Button's spinner is its label colour, so a cell the Button
      ledger already records below the bar is held to that cell's floor. */
  button?: { intent: string; variant: string };
}

const hosts: Host[] = [];
const host = (id: string, button?: Host["button"]) => {
  hosts.push({ id, button });
  return { "data-testid": id };
};

function floorFor(h: Host, scheme: "light" | "dark"): number {
  if (!h.button) return MIN_GRAPHIC_CONTRAST;
  const debt = CONTRAST_DEBT_BY_KEY.get(contrastDebtKey({ ...h.button, scheme, state: "rest" }));
  return debt ? Math.min(MIN_GRAPHIC_CONTRAST, debt.measuredRatio - 0.05) : MIN_GRAPHIC_CONTRAST;
}

function alphaOf(rgb: string): number {
  const parts = rgb.match(/[\d.]+/g) ?? [];
  return parts.length === 4 ? Number(parts[3]) : 1;
}

describe(`Spinner contrast in every host (>= ${MIN_GRAPHIC_CONTRAST}:1)`, () => {
  let container: HTMLDivElement;
  let removeNoTransitionStyle: () => void;

  beforeAll(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    removeNoTransitionStyle = installNoTransitionStyle();
    container.classList.add(NO_TRANSITION_CLASS);
    await render(
      <SoribashiProvider theme={tuiTheme}>
        {tuiVocabulary.intent.values.flatMap((intent) =>
          tuiVocabulary.variant.values.map((variant) => (
            <Button
              key={`${intent}-${variant}`}
              intent={intent}
              variant={variant}
              busy
              attributes={{ root: host(`button-${variant}-${intent}`, { intent, variant }) }}
            >
              {intent}
            </Button>
          )),
        )}
        {BADGE_INTENTS.map((intent) => (
          <Badge key={intent} intent={intent} attributes={{ root: host(`badge-${intent}`) }}>
            <Spinner size="xs" />
            {intent}
          </Badge>
        ))}
        <span {...host("text")} style={{ color: "var(--text-1)" }}>
          <Spinner size="xs" /> loading
        </span>
      </SoribashiProvider>,
      { container },
    );
  });

  afterAll(() => {
    container.remove();
    removeNoTransitionStyle();
  });

  function solidBackground(el: HTMLElement): string {
    for (let at: HTMLElement | null = el; at && at !== container; at = at.parentElement) {
      const bg = toRgbString(getComputedStyle(at).backgroundColor);
      if (alphaOf(bg) > 0) return bg;
    }
    return resolveCanvasColor(container);
  }

  function measure(h: Host, scheme: "light" | "dark"): string | null {
    const { id } = h;
    const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const arc = el?.querySelector(`[data-part="${SPINNER_PARTS.root}"] path`);
    if (!el || !arc) throw new Error(`${id}: no spinner rendered`);
    const stroke = toRgbString(getComputedStyle(arc).stroke);
    const bg = solidBackground(el);
    const ratio = contrastRatio(stroke, bg, resolveCanvasColor(container));
    return ratio >= floorFor(h, scheme)
      ? null
      : `${scheme}/${id}: stroke=${stroke} bg=${bg} ratio=${ratio.toFixed(2)}`;
  }

  const failures = (scheme: "light" | "dark") =>
    hosts.map((h) => measure(h, scheme)).filter((f): f is string => f !== null);

  test("light scheme", () => {
    expect(failures(SCHEMES[0])).toEqual([]);
  });

  test("dark scheme", () => {
    container.classList.add("dark");
    void container.offsetHeight;
    try {
      expect(failures(SCHEMES[1])).toEqual([]);
    } finally {
      container.classList.remove("dark");
    }
  });
});
