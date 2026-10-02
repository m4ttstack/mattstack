/**
 * The design fixture's scenarios (`CONSOLE_FIXTURE_SCENARIO`). `clean` and
 * `unsynced` are the data the boards were drawn from. Every other one is
 * `clean` with one thing changed, so a Graph tab state no board draws can be
 * looked at by focusing its `subject`:
 *
 * | scenario           | what changes                                          |
 * | ------------------ | ----------------------------------------------------- |
 * | `referenced`       | plan's domain slot links to its fill                  |
 * | `required-unbound` | nothing binds plan's required domain slot             |
 * | `optional-unbound` | nothing binds plan's domain slot, made optional       |
 * | `no-matching-fill` | plan's domain slot names a fill the pack lacks        |
 * | `resolve-error`    | rt cannot resolve release-notes' changelog slot       |
 * | `legacy`           | plan comes from an engine with no template trace      |
 * | `never-compiled`   | plan has never been compiled                          |
 * | `anatomy-failed`   | rt fails to read plan                                 |
 * | `check-failed`     | `rt skills check` fails                               |
 * | `changes-failed`   | the pending-changes poll fails                        |
 */

export const SCENARIOS = [
  'clean',
  'unsynced',
  'referenced',
  'required-unbound',
  'optional-unbound',
  'no-matching-fill',
  'resolve-error',
  'legacy',
  'never-compiled',
  'anatomy-failed',
  'check-failed',
  'changes-failed',
] as const;

export type FixtureScenario = (typeof SCENARIOS)[number];

type Range = [number, number];

interface Part {
  kind: string;
  name: string | null;
  templateLines: Range | null;
  renderedLines: Range | null;
  mode: string | null;
  source: unknown;
  target: unknown;
  changed: boolean;
}

export interface Anatomy {
  skill: string;
  status: string;
  template: { builtVersion: string | null };
  rendered: { path: string; exists: boolean; lines: number };
  parts: Part[];
  links: unknown[];
}

interface Composition {
  verbs: { name: string; slots: Record<string, unknown>[] }[];
  targets: { name: string; slots: { name: string; required: boolean }[] }[];
  binders: {
    ref: string;
    slots: { name: string; boundTo: string; layer?: string | null }[];
  }[];
}

interface Check {
  verbs: { name: string; status: string }[];
}

/** What rt prints when a verb fails: an exit code and stderr, no stdout. */
export interface Failure {
  code: number;
  stderr: string;
}

export interface ScenarioDef {
  /** The skill to focus to see what the scenario changes. */
  subject: string;
  composition?: (composition: Composition) => Composition;
  check?: ((check: Check) => Check) | Failure;
  changes?: Failure;
  /** A skill's anatomy: a payload file, edited, or a failure. */
  anatomy?: Record<
    string,
    { file: string; edit?: (anatomy: Anatomy) => Anatomy } | Failure
  >;
  /** A `/fixture` file, edited, or null where it does not exist. */
  files?: Record<string, ((text: string) => string) | null>;
}

const PLAN_FILE = 'anatomy.stage-plan.json';
const PLAN_RENDERED = '/fixture/packs/acme/attachments/stage-plan/SKILL.md';
const PLAN_BINDER = 'mattstack:stage-plan';
/** Where the clean build pastes plan-policy into plan's rendered file. */
const DOMAIN_BODY: Range = [223, 302];

const REFERENCE_LINE =
  'Slot domain is bound to `acme:plan-policy` (acme:plan-policy@0.8.14) -- invoke that skill when this flow needs it.';

const CHANGELOG_ERROR = [
  'loadAttachment: slot "changelog": binding "acme:changelog-style" not found; searched:',
  '/fixture/packs/acme/skills/changelog-style/SKILL.md',
  '/fixture/packs/acme/attachments/changelog-style/SKILL.md',
].join('\n');

export const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'stderr' in value;

/** Replaces lines `from`..`to` (1-based) of a file with `lines`. */
function spliceLines(text: string, [from, to]: Range, lines: string[]): string {
  const all = text.split('\n');
  all.splice(from - 1, to - from + 1, ...lines);
  return all.join('\n');
}

/** Moves every part placed after `line` by `by` lines. */
function shiftAfter(parts: Part[], line: number, by: number): Part[] {
  return parts.map(part =>
    part.renderedLines && part.renderedLines[0] > line
      ? {
          ...part,
          renderedLines: [
            part.renderedLines[0] + by,
            part.renderedLines[1] + by,
          ],
        }
      : part
  );
}

/** Plan with its domain slot rendered into `lines` lines in place of its
    pasted body. */
function domainRenderedAs(lines: 0 | 1, patch: Partial<Part>) {
  const by = lines - (DOMAIN_BODY[1] - DOMAIN_BODY[0] + 1);
  return (anatomy: Anatomy): Anatomy => ({
    ...anatomy,
    rendered: { ...anatomy.rendered, lines: anatomy.rendered.lines + by },
    parts: shiftAfter(anatomy.parts, DOMAIN_BODY[1], by).map(part =>
      part.name === 'domain' ? { ...part, ...patch } : part
    ),
  });
}

const domainUnbound = domainRenderedAs(0, {
  source: null,
  renderedLines: null,
  mode: null,
});

const withoutDomainBody = (text: string) =>
  spliceLines(text, DOMAIN_BODY, []).replace(' + acme:plan-policy@0.8.14', '');

function bindDomain(boundTo: string | null) {
  return (composition: Composition): Composition => ({
    ...composition,
    binders: composition.binders.map(binder =>
      binder.ref === PLAN_BINDER
        ? {
            ...binder,
            slots: boundTo ? [{ name: 'domain', boundTo, layer: 'pack' }] : [],
          }
        : binder
    ),
  });
}

function optionalDomain(composition: Composition): Composition {
  return {
    ...composition,
    targets: composition.targets.map(target =>
      target.name === 'stage-plan'
        ? {
            ...target,
            slots: target.slots.map(slot => ({ ...slot, required: false })),
          }
        : target
    ),
  };
}

function failingChangelog(composition: Composition): Composition {
  return {
    ...composition,
    verbs: composition.verbs.map(verb =>
      verb.name === 'release-notes'
        ? {
            ...verb,
            slots: verb.slots.map(slot => ({
              ...slot,
              boundTo: 'acme:changelog-style',
              layer: 'pack',
              resolveError: CHANGELOG_ERROR,
            })),
          }
        : verb
    ),
  };
}

/** What rt reads from plan's rendered file's `part:` markers when its engine
    leaves no template trace (rt's `partsFromMarkers`). */
function fromMarkers(anatomy: Anatomy): Anatomy {
  const source = (name: string) =>
    anatomy.parts.find(part => part.name === name)?.source ?? null;
  const part = (
    kind: string,
    name: string | null,
    renderedLines: Range
  ): Part => ({
    kind,
    name,
    templateLines: null,
    renderedLines,
    mode: null,
    source: name ? source(name) : null,
    target: null,
    changed: false,
  });
  return {
    ...anatomy,
    parts: [
      part('text', null, [12, 48]),
      part('include', 'execution-strategy', [49, 197]),
      part('include', 'gate-protocol', [303, 749]),
      part('include', 'wrap-up-form', [753, 780]),
    ],
  };
}

function neverCompiled(anatomy: Anatomy): Anatomy {
  return {
    ...anatomy,
    status: 'never-compiled',
    template: { ...anatomy.template, builtVersion: null },
    rendered: { ...anatomy.rendered, exists: false, lines: 0 },
    parts: anatomy.parts.map(part => ({ ...part, renderedLines: null })),
    links: [],
  };
}

function planCheck(status: string) {
  return (check: Check): Check => ({
    ...check,
    verbs: check.verbs.map(row =>
      row.name === 'stage-plan' ? { ...row, status } : row
    ),
  });
}

const unboundPlan = {
  subject: 'stage-plan',
  anatomy: { 'stage-plan': { file: PLAN_FILE, edit: domainUnbound } },
  files: { [PLAN_RENDERED]: withoutDomainBody },
} satisfies Partial<ScenarioDef>;

const DEFS: Record<FixtureScenario, ScenarioDef> = {
  clean: { subject: 'stage-plan' },
  unsynced: { subject: 'stage-plan' },
  referenced: {
    subject: 'stage-plan',
    anatomy: {
      'stage-plan': {
        file: PLAN_FILE,
        edit: domainRenderedAs(1, {
          mode: 'reference',
          renderedLines: [DOMAIN_BODY[0], DOMAIN_BODY[0]],
        }),
      },
    },
    files: {
      [PLAN_RENDERED]: text => spliceLines(text, DOMAIN_BODY, [REFERENCE_LINE]),
    },
  },
  'required-unbound': { ...unboundPlan, composition: bindDomain(null) },
  'optional-unbound': {
    ...unboundPlan,
    composition: composition => optionalDomain(bindDomain(null)(composition)),
  },
  'no-matching-fill': {
    ...unboundPlan,
    composition: bindDomain('acme:plan-policy-v1'),
  },
  'resolve-error': {
    subject: 'release-notes',
    composition: failingChangelog,
    anatomy: { 'release-notes': { file: 'anatomy.release-notes.json' } },
  },
  legacy: {
    subject: 'stage-plan',
    anatomy: { 'stage-plan': { file: PLAN_FILE, edit: fromMarkers } },
  },
  'never-compiled': {
    subject: 'stage-plan',
    anatomy: { 'stage-plan': { file: PLAN_FILE, edit: neverCompiled } },
    check: planCheck('never-compiled'),
    files: { [PLAN_RENDERED]: null },
  },
  'anatomy-failed': {
    subject: 'stage-plan',
    anatomy: {
      'stage-plan': {
        code: 1,
        stderr:
          'rt skills anatomy: the template for stage-plan could not be read (EACCES: permission denied)',
      },
    },
  },
  'check-failed': {
    subject: 'stage-plan',
    check: {
      code: 2,
      stderr:
        'rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")',
    },
  },
  'changes-failed': {
    subject: 'stage-plan',
    changes: {
      code: 1,
      stderr: 'rt skills changes: /fixture/packs/acme is not a git checkout',
    },
  },
};

export function scenarioOf(scenario: FixtureScenario): ScenarioDef {
  return DEFS[scenario];
}

export function isScenario(value: string): value is FixtureScenario {
  return (SCENARIOS as readonly string[]).includes(value);
}
