import { homedir } from 'node:os';
import { join } from 'node:path';

/** One named layer as the collector (`collect.js`) sees it, box relative to the board root. */
export interface ParityNode {
  key: string;
  kind: 'text' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  color: string | null;
  text: string | null;
  /** Product of opacities from the node up to (not including) the root's parent. */
  opacity?: number;
  /** Raw layer name, before the key's `[i]` suffix. */
  name?: string;
  /** Index into the same array of the nearest named ancestor; -1 for the root. */
  parent?: number;
  tag?: string;
}

export interface Mismatch {
  key: string;
  field: string;
  design: string;
  app: string;
}

/** Text a layer must match (a RegExp source) before the runner collects. */
export interface TextWait {
  layer: string;
  pattern: string;
  timeoutMs: number;
}

/** What the runner does after the route loads, before collecting. */
export type BoardAction =
  | { kind: 'click'; layer: string; waitFor: string; until?: TextWait }
  | {
      kind: 'hover';
      layer: string;
      waitFor: string;
      /** CSS attribute selectors narrowing the layer, e.g. `[data-kind="you"]`; the first match is hovered. */
      where?: string;
      until?: TextWait;
    }
  | { kind: 'waitText'; layer: string; until: TextWait }
  /** Presses a shortcut once the app has drawn, then types, e.g. a palette's `ControlOrMeta+k`. */
  | {
      kind: 'type';
      press: string;
      text: string;
      waitFor: string;
      until?: TextWait;
    }
  /** Clicks each layer in order, waiting for each to be visible first. */
  | { kind: 'clicks'; layers: string[]; waitFor: string; until?: TextWait };

export interface Board<Scenario extends string = string> {
  slug: string;
  /** Top-level frame name in the app's `.pen`. */
  frame: string;
  /** Pencil node id of that frame, for re-exporting. */
  frameId: string;
  /** Absolute path of the `.pen` holding `frame`, when not the app's `penPath`. */
  penPath?: string;
  route: string;
  /** localStorage entries (raw stored strings) set before the route loads. */
  storage: Record<string, string>;
  scenario: Scenario;
  /**
   * Content layers compared on `route`, each by its `data-parity` (app) and
   * `data-pencil-name` (design) value. The chrome around them is the kit's, so
   * only content is compared, with boxes relative to each content root.
   */
  roots: string[];
  /**
   * The app's `data-parity` for a root the board names apart from a sibling
   * drawn in the same frame (two record headers on one board, both the app's
   * `Hero`). The app root is collected under the design root's name.
   */
  appRoots?: Record<string, string>;
  /** Viewport height in CSS px. The design side is `viewportWidth` wide; the app side is sized so each root matches its design width. */
  height: number;
  dynamicText: string[];
  /**
   * Text a `<p>` under a root shows while that root is still loading. When
   * set, the runner waits until no root shows it before collecting.
   */
  settleText?: string;
  action?: BoardAction;
  /** Boards drawn as several panels compare each panel on its own route, instead of `roots`. */
  panels?: BoardPanel[];
}

export interface BoardPanel {
  label: string;
  route: string;
  root: string;
  /** Run after this panel's route loads, in place of the board's `action`. */
  action?: BoardAction;
}

/** One compared content root. */
export interface ParityTarget {
  /** Output file stem, e.g. `01-leaderboard-table.standings` or `04-stat-evidence-variants.coding-days`. */
  stem: string;
  root: string;
  route: string;
  action?: BoardAction;
}

/**
 * Everything the shared harness needs from one app. An app's
 * `scripts/parity/harness.ts` builds this and exports it as `app`: the
 * harness server (`startHarness`) and the compare CLI (`--app <name>`, which
 * imports that file) both read it from there.
 */
export interface ParityApp<Scenario extends string = string> {
  boards: Board<Scenario>[];
  /** Absolute dir holding the design exports, `<slug>.<dark|light>.html`. */
  designDir: string;
  /** Absolute path of the `.pen` the exports came from. */
  penPath: string;
  /** Default port of this app's harness; `PARITY_HARNESS_PORT` overrides it. */
  harnessPort: number;
  /** Origin the runner loads the app from; `PARITY_APP_ORIGIN` overrides it. */
  appOrigin: string;
  /** Width of the design frames in CSS px. Defaults to `VIEWPORT_WIDTH`. */
  viewportWidth?: number;
  /**
   * Where `<stem>.<scheme>.*` files are written and read. Defaults to
   * `OUTPUT_DIR`; two apps sharing it collide when their slugs match.
   */
  outputDir?: string;
}

export const VIEWPORT_WIDTH = 1440;
export const DESIGN_NAME_ATTR = 'data-pencil-name';
export const APP_NAME_ATTR = 'data-parity';
export const OUTPUT_DIR = join(homedir(), '.fast-browser', 'output', 'parity');

export const outputDirOf = (app: ParityApp): string =>
  app.outputDir ?? OUTPUT_DIR;

export function boardBySlug<S extends string>(
  boards: Board<S>[],
  slug: string
): Board<S> {
  const board = boards.find(b => b.slug === slug);
  if (!board) {
    throw new Error(
      `unknown board "${slug}"; one of: ${boards.map(b => b.slug).join(', ')}`
    );
  }
  return board;
}

const stemPart = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** `panel` (a panel's label, any case, or its root) keeps only that panel. */
export function targetsOf(board: Board, panel?: string): ParityTarget[] {
  if (board.panels) {
    const panels = panel
      ? board.panels.filter(
          p => stemPart(p.label) === stemPart(panel) || p.root === panel
        )
      : board.panels;
    if (panels.length === 0) {
      throw new Error(
        `no panel "${panel}" on ${board.slug}; one of: ${board.panels.map(p => p.label).join(', ')}`
      );
    }
    return panels.map(p => ({
      stem: `${board.slug}.${stemPart(p.label)}`,
      root: p.root,
      route: p.route,
      action: p.action ?? board.action,
    }));
  }
  return board.roots.map(root => ({
    stem: `${board.slug}.${stemPart(root)}`,
    root,
    route: board.route,
    action: board.action,
  }));
}
