// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gateBoardPath, type BoardGate } from './gateBoards';

let home: string;
let uid: number;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'gate-boards-')));
  uid = process.getuid!();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function file(rel: string, bytes = 'png'): string {
  const p = join(home, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, bytes);
  return p;
}

function gate(paths: string[], over: Partial<BoardGate> = {}): BoardGate {
  return {
    status: 'open',
    subject: 'run:run-1',
    origin: null,
    context: JSON.stringify({
      'gate-ctx': 'boards@1',
      boards: paths.map((path, i) => ({
        case: `case-${i}`,
        slot: 'after',
        path,
        caption: 'A claim',
      })),
    }),
    ...over,
  };
}

const serve = (g: BoardGate, path: string, asUid = uid) =>
  gateBoardPath({ gate: g, path, home, uid: asUid });

describe('gateBoardPath serves', () => {
  it('a board in the screenshots folder that the open gate names', () => {
    const p = file('.fast-browser/screenshots/run-1-a-after.png');
    expect(serve(gate([p]), p)).toBe(p);
  });

  it('a board in the evidence store', () => {
    const p = file('.mattstack/evidence/abc/board.webp');
    expect(serve(gate([p]), p)).toBe(p);
  });

  it("a board in the gate's own run evidence folder", () => {
    const p = file('.mattstack/work/run-1/evidence/abc/board.jpg');
    expect(serve(gate([p]), p)).toBe(p);
  });

  it('a board on a parked gate, which is still waiting on the human', () => {
    const p = file('.fast-browser/screenshots/b.png');
    expect(serve(gate([p], { status: 'parked' }), p)).toBe(p);
  });
});

describe('gateBoardPath refuses', () => {
  it('a path the gate does not name', () => {
    const named = file('.fast-browser/screenshots/a.png');
    const other = file('.fast-browser/screenshots/b.png');
    expect(serve(gate([named]), other)).toBeNull();
  });

  it.each(['answered', 'closed'] as const)('a %s gate', status => {
    const p = file('.fast-browser/screenshots/a.png');
    expect(serve(gate([p], { status }), p)).toBeNull();
  });

  it('a gate whose context is not boards@1', () => {
    const p = file('.fast-browser/screenshots/a.png');
    expect(serve(gate([p], { context: `Boards:\n- ${p}` }), p)).toBeNull();
  });

  it('an image outside every allowed root', () => {
    const p = file('Desktop/a.png');
    expect(serve(gate([p]), p)).toBeNull();
  });

  it("another run's evidence folder", () => {
    const p = file('.mattstack/work/run-2/evidence/abc/board.png');
    expect(serve(gate([p]), p)).toBeNull();
  });

  it('a symlink in an allowed root that points outside it', () => {
    const outside = file('secrets/key.png');
    const link = join(home, '.fast-browser/screenshots/link.png');
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(outside, link);
    expect(serve(gate([link]), link)).toBeNull();
  });

  it('a file that is not an image, even when the gate names it', () => {
    const p = file('.fast-browser/screenshots/a.spec.json');
    const g = gate([], {
      context: JSON.stringify({
        'gate-ctx': 'boards@1',
        boards: [{ case: 'a', slot: 'after', path: p, caption: 'c' }],
      }),
    });
    expect(serve(g, p)).toBeNull();
  });

  it('a file another user owns', () => {
    const p = file('.fast-browser/screenshots/a.png');
    expect(serve(gate([p]), p, uid + 1)).toBeNull();
  });

  it('a directory', () => {
    const dir = join(home, '.fast-browser/screenshots/dir.png');
    mkdirSync(dir, { recursive: true });
    expect(serve(gate([dir]), dir)).toBeNull();
  });

  it('a board that is not on disk', () => {
    const p = join(home, '.fast-browser/screenshots/gone.png');
    expect(serve(gate([p]), p)).toBeNull();
  });
});
