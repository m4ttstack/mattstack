// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import anatomyPlan from './anatomy.stage-plan.json';
import anatomyPlanUnsynced from './anatomy.stage-plan.unsynced.json';
import anatomyWork from './anatomy.work.json';
import changesUnsynced from './changes.unsynced.json';
import composition from './composition.json';
import compositionUnsynced from './composition.unsynced.json';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const EXPORTS = fileURLToPath(
  new URL('../../../../../../docs/apps/design/console/parity/', import.meta.url)
);

const fixtureFile = (path: string) =>
  readFileSync(join(HERE, 'files', path.replace(/^\/fixture\//, '')), 'utf8');
const linesOf = (path: string) =>
  fixtureFile(path).replace(/\n$/, '').split('\n');
const board = (slug: string) =>
  readFileSync(join(EXPORTS, `${slug}.light.html`), 'utf8');

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Each numbered code line a drawer board draws, as the browser would read it. */
function boardCodeLines(html: string): Map<number, string> {
  const lines = new Map<number, string>();
  const re =
    /data-pencil-name="line (\d+)"[\s\S]*?data-pencil-name="code"[^>]*>([^<]*)<\/div>/g;
  for (const m of html.matchAll(re)) lines.set(Number(m[1]), decode(m[2]!));
  return lines;
}

const collapsed = (line: string) => line.replace(/\s+/g, ' ').trim();

function expectLinesMatch(path: string, html: string, count: number) {
  const drawn = boardCodeLines(html);
  expect(drawn.size).toBe(count);
  const file = linesOf(path);
  for (const [n, text] of drawn)
    expect([n, collapsed(file[n - 1]!)]).toEqual([n, text]);
}

const PLACEHOLDER_RE = /\{\{([a-z][a-z0-9.-]*)(?::([^}\s]+))?\}\}/g;
const LINK_RE =
  /(?:\.\.\/)+(?:attachments|skills)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_./-]+\.md/g;

const target = (name: string) => {
  const t = composition.targets.find(x => x.name === name);
  if (!t) throw new Error(`no target ${name}`);
  return t;
};

describe('fixture files match the drawer boards', () => {
  it('work template lines 1-44 are the text-range drawer', () => {
    expectLinesMatch(anatomyWork.template.path, board('drawer-text-range'), 44);
  });

  it('stage-plan rendered lines 288-330 are the include-row drawer', () => {
    expectLinesMatch(
      anatomyPlan.rendered.path,
      board('drawer-include-row'),
      43
    );
  });

  it('stage-plan rendered lines 223-232 are the rebind drawer', () => {
    expectLinesMatch(anatomyPlan.rendered.path, board('drawer-rebind'), 10);
  });
});

describe('fixture payloads agree with their files', () => {
  it.each([anatomyWork, anatomyPlan, anatomyPlanUnsynced])(
    '$skill template and rendered line counts',
    anatomy => {
      expect(linesOf(anatomy.template.path)).toHaveLength(
        anatomy.template.lines
      );
      expect(linesOf(anatomy.rendered.path)).toHaveLength(
        anatomy.rendered.lines
      );
    }
  );

  it.each(['work', 'stage-plan'])(
    '%s placeholders are the template file',
    name => {
      const t = target(name);
      const found = linesOf(t.templatePath).flatMap((line, i) =>
        [...line.matchAll(PLACEHOLDER_RE)].map(m => ({
          kind: m[1],
          arg: m[2] ?? null,
          line: i + 1,
        }))
      );
      expect(t.placeholders).toEqual(found);
    }
  );

  it.each([anatomyWork, anatomyPlan])(
    '$skill links are the rendered file',
    anatomy => {
      const found = new Map<string, number>();
      linesOf(anatomy.rendered.path).forEach((line, i) => {
        for (const m of line.matchAll(LINK_RE))
          if (!found.has(m[0])) found.set(m[0], i + 1);
      });
      expect(anatomy.links).toEqual(
        [...found].map(([path, line]) => ({ path, line }))
      );
    }
  );

  it('a stale skill places only its marked parts', () => {
    const rendered = linesOf(anatomyWork.rendered.path);
    for (const part of anatomyWork.parts) {
      if (part.kind !== 'include' && part.kind !== 'slot') {
        expect(part.renderedLines).toBeNull();
        continue;
      }
      const [start] = part.renderedLines!;
      expect(rendered[start - 1]).toMatch(
        new RegExp(`^<!-- part: ${part.kind}:${part.name} `)
      );
    }
  });

  it('the plan-stage parts tile its rendered file without overlap', () => {
    const placed = anatomyPlan.parts
      .map(p => p.renderedLines)
      .filter((r): r is number[] => r !== null);
    let next = 1;
    for (const [a, b] of placed) {
      expect(a).toBe(next);
      next = b! + 1;
    }
    expect(next - 1).toBe(anatomyPlan.rendered.lines);
  });

  it("work's step links name the stages' rendered sizes", () => {
    const plan = anatomyWork.parts.find(p => p.name === 'stage-plan');
    expect(plan?.target).toEqual({
      skill: 'stage-plan',
      path: anatomyPlan.rendered.path,
      lines: anatomyPlan.rendered.lines,
    });
  });

  it('the unsynced composition differs from the clean one by its one pending binding', () => {
    const [change] = changesUnsynced.bindings;
    const rebound = structuredClone(composition);
    const binder = rebound.binders.find(b => b.ref === change!.engineRef)!;
    binder.slots.find(s => s.name === change!.slot)!.boundTo = change!.to;
    expect(compositionUnsynced).toEqual(rebound);
  });
});

describe('fixture payloads match the input-card board', () => {
  it('every Used by row names the line its skill pastes gate-protocol at', () => {
    const html = board('drawer-input-card');
    const rows = [
      ...html.matchAll(
        /data-pencil-name="row · ([a-z-]+)"[\s\S]*?data-pencil-name="at"[^>]*>([^<]*)</g
      ),
    ].map(m => [m[1], Number(/L(\d+)/.exec(m[2]!)![1])] as const);
    expect(rows).toHaveLength(14);

    const pasting = composition.targets
      .filter(t =>
        t.placeholders.some(
          p => p.kind === 'include' && p.arg === 'gate-protocol'
        )
      )
      .map(t => t.name);
    expect(new Set(pasting)).toEqual(new Set(rows.map(([name]) => name)));
    for (const [name, line] of rows) {
      expect(
        target(name).placeholders.find(p => p.arg === 'gate-protocol')?.line
      ).toBe(line);
    }
  });
});
