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
 * | `org-base`         | the pack extends `acme-base`, which fills plan's domain |
 * | `org-base-drift`   | `org-base`, with a stale base copy and a base error   |
 *
 * `runs` and `runs-empty` are the runs boards' data (`runsFixture.ts`), with
 * the skills routes answering as `clean`. Every other scenario serves no runs.
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
  'org-base',
  'org-base-drift',
  'runs',
  'runs-empty',
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

interface Anatomy {
  skill: string;
  status: string;
  template: { builtVersion: string | null };
  rendered: { path: string; exists: boolean; lines: number };
  parts: Part[];
  links: unknown[];
}

interface Composition {
  verbs: { name: string; slots: Record<string, unknown>[] }[];
  fills: { binding: string }[];
  extends?: { name: string; version: string | null } | null;
  targets: { name: string; slots: { name: string; required: boolean }[] }[];
  binders: {
    ref: string;
    slots: { name: string; boundTo: string; layer?: string | null }[];
  }[];
}

interface Check {
  verbs: { name: string; status: string }[];
  attachments?: unknown[];
  baseErrors?: string[];
}

interface Surface {
  pack: string;
  packDir: string;
  rows: { name: string; kind: string; status: string; base?: string }[];
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
  /** `rt skills surface list`; every scenario without one refuses it. */
  surface?: Surface;
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

/** `from` and `to` are 1-based and inclusive, as a rendered range is. */
function spliceLines(text: string, [from, to]: Range, lines: string[]): string {
  const all = text.split('\n');
  all.splice(from - 1, to - from + 1, ...lines);
  return all.join('\n');
}

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

const BASE = 'acme-base';
const BASE_BINDING = `${BASE}:plan-policy`;
const BASE_PLAN_FILE = `/fixture/orgbase/${BASE}/attachments/plan-policy/SKILL.md`;
const BASE_TAG = { origin: 'base', base: BASE, baseVersion: '0.1.0' } as const;

const SHEPHERDR_BINDER = 'mattstack:shepherdr';
const baseDomainSlot = {
  name: 'domain',
  boundTo: BASE_BINDING,
  layer: `base:${BASE}`,
  ...BASE_TAG,
};

/** The pack extends `acme-base`, whose plan-policy fills plan's domain slot
    in place of the pack's own. `acme:plan-policy-lite` stays in the fills as
    a rebind candidate, like plan-policy-strict. */
function baseFillsDomain(composition: Composition): Composition {
  return {
    ...composition,
    extends: { name: BASE, version: '0.1.0' },
    verbs: composition.verbs.map(verb =>
      verb.name === 'shepherdr'
        ? {
            ...verb,
            slots: verb.slots.map(slot =>
              slot.name === 'domain'
                ? {
                    ...slot,
                    boundTo: BASE_BINDING,
                    layer: `base:${BASE}`,
                    fillSourcePath: BASE_PLAN_FILE,
                    fillVersion: 'org',
                    ...BASE_TAG,
                  }
                : slot
            ),
          }
        : verb
    ),
    binders: composition.binders.map(binder => {
      if (binder.ref === PLAN_BINDER) {
        return { ...binder, slots: [baseDomainSlot] };
      }
      if (binder.ref === SHEPHERDR_BINDER) {
        return {
          ...binder,
          slots: binder.slots.map(slot =>
            slot.name === 'domain' ? baseDomainSlot : slot
          ),
        };
      }
      return binder;
    }),
    fills: composition.fills.map(fill =>
      fill.binding === 'acme:plan-policy'
        ? {
            ...fill,
            binding: BASE_BINDING,
            sourcePath: BASE_PLAN_FILE,
            ...BASE_TAG,
          }
        : fill
    ),
  };
}

/** Plan's domain part reads from the base fill, whose version is the `org`
    token rt reports for an org base. */
function domainFromBase(anatomy: Anatomy): Anatomy {
  return {
    ...anatomy,
    parts: anatomy.parts.map(part =>
      part.name === 'domain'
        ? {
            ...part,
            source: {
              ...(part.source as object),
              ref: BASE_BINDING,
              path: BASE_PLAN_FILE,
              version: 'org',
              builtVersion: 'org',
              ...BASE_TAG,
            },
          }
        : part
    ),
  };
}

const attachmentRow = (status: 'in-sync' | 'stale') => ({
  name: 'dev-servers',
  base: BASE,
  status,
  staleFiles: status === 'stale' ? ['SKILL.md'] : [],
  orphanFiles: [],
});

const orgBase = {
  subject: 'stage-plan',
  composition: baseFillsDomain,
  anatomy: { 'stage-plan': { file: PLAN_FILE, edit: domainFromBase } },
  surface: {
    pack: 'acme',
    packDir: '/fixture/packs/acme',
    rows: [
      { name: 'dev-servers', kind: 'compiled', status: 'internal', base: BASE },
      { name: 'gates', kind: 'compiled', status: 'internal' },
      { name: 'plan-policy', kind: 'hand-authored', status: 'internal' },
    ],
  },
} satisfies Partial<ScenarioDef>;

const DEFS: Record<FixtureScenario, ScenarioDef> = {
  clean: { subject: 'stage-plan' },
  runs: { subject: 'stage-plan' },
  'runs-empty': { subject: 'stage-plan' },
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
  'org-base': {
    ...orgBase,
    check: check => ({
      ...check,
      attachments: [attachmentRow('in-sync')],
      baseErrors: [],
    }),
  },
  'org-base-drift': {
    ...orgBase,
    check: check => ({
      ...check,
      attachments: [attachmentRow('stale')],
      baseErrors: [`${BASE} has no attachments/feature-flags`],
    }),
  },
};

export function scenarioOf(scenario: FixtureScenario): ScenarioDef {
  return DEFS[scenario];
}

export function isScenario(value: string): value is FixtureScenario {
  return (SCENARIOS as readonly string[]).includes(value);
}
