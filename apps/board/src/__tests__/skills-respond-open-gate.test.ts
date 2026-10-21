import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const script = join(
  import.meta.dir,
  '..',
  '..',
  'skills-src',
  'respond',
  'scripts',
  'open-gate.sh'
);

type Question = {
  id: string;
  label?: string;
  multi?: boolean;
  context?: string;
  options: unknown[];
};
type Open = { context?: string; questions: Question[] };

const dir = mkdtempSync(join(tmpdir(), 'open-gate-'));
const statusBin = join(dir, 'status-bin');
writeFileSync(
  statusBin,
  `#!/bin/sh
jq -nc '$ARGS.positional' --args -- "$@" >> "$CALLS"
while [ $# -gt 0 ]; do
  [ "$1" = --open-file ] && cat "$2" > "$CALLS.open"
  shift
done
echo '{"gateId":"g-1","presentation":"form"}'
exit "\${STUB_EXIT:-0}"
`
);
chmodSync(statusBin, 0o755);

let n = 0;
const run = (open: Open | string, env: Record<string, string> = {}) => {
  n += 1;
  const file = join(dir, `open-${n}.json`);
  const calls = join(dir, `calls-${n}.jsonl`);
  writeFileSync(file, typeof open === 'string' ? open : JSON.stringify(open));
  writeFileSync(calls, '');
  const proc = Bun.spawnSync(
    ['sh', script, statusBin, '/board/respond/7.json', 'respond-plan', file],
    { env: { ...process.env, CALLS: calls, ...env } }
  );
  const argv = readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[]);
  const sent = existsSync(`${calls}.open`)
    ? (JSON.parse(readFileSync(`${calls}.open`, 'utf8')) as Open)
    : undefined;
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    argv,
    sent,
  };
};

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const thread = (i: number, context: string): Question => ({
  id: `thread-${i}`,
  label: `src/mod${i}.ts:${i * 10}`,
  multi: false,
  context,
  options: [
    { value: `reply:t${i}`, label: 'reply', description: 'reply only' },
    { value: `fix:t${i}`, label: 'fix', description: 'add the guard' },
    { value: `skip:t${i}`, label: 'skip', description: 'no reply' },
  ],
});
const codeChanges: Question = {
  id: 'code-changes',
  label: 'Approve the proposed code changes?',
  multi: false,
  options: ['approve', 'revise', 'skip'],
};

describe('open-gate.sh', () => {
  test('opens an under-budget file exactly as fitted', () => {
    const open: Open = {
      context: '{"gate-ctx":"plan@1","reviewer":"ada","threads":{"total":1}}',
      questions: [
        thread(1, '{"gate-ctx":"thread@1","author":"ada"}'),
        codeChanges,
      ],
    };
    const r = run(open);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('{"gateId":"g-1","presentation":"form"}');
    expect(r.argv).toHaveLength(1);
    const argv = r.argv[0]!;
    expect(argv.slice(0, 6)).toEqual([
      'gate',
      'open',
      '/board/respond/7.json',
      '--kind',
      'respond-plan',
      '--open-file',
    ]);
    expect(argv).toHaveLength(7);
    expect(r.sent).toEqual(open);
  });

  test('drops the pane-only next question and nothing else', () => {
    const reply = (n: number): Question => ({
      id: `thread-${n}`,
      label: `src/mod${n}.ts:10`,
      multi: true,
      context: `{"gate-ctx":"reply@1","thread":"t${n}","file":"src/mod${n}.ts:10","verb":"reply","text":"done"}`,
      options: [
        { value: `post:t${n}`, label: 'post' },
        { value: `resolve:t${n}`, label: 'resolve' },
      ],
    });
    const next: Question = {
      id: 'next',
      label: 'Next',
      multi: false,
      options: ['proceed', 'iterate', 'hold'],
    };
    const r = run({
      context: '{"gate-ctx":"post@1"}',
      questions: [reply(1), reply(2), next],
    });
    expect(r.exitCode).toBe(0);
    expect(r.sent?.questions).toEqual([reply(1), reply(2)]);
  });

  test('a file over 1 MB opens as is, every context whole, none of it on argv', () => {
    const questions = Array.from({ length: 40 }, (_, i) =>
      thread(i, 'y'.repeat(30000 + i))
    );
    const context = `Responding to ada · ${'z'.repeat(40000)}`;
    const r = run({ context, questions: [...questions, codeChanges] });
    expect(r.exitCode).toBe(0);
    expect(JSON.stringify(r.sent).length).toBeGreaterThan(1_048_576);
    expect(r.sent).toEqual({ context, questions: [...questions, codeChanges] });
    expect(JSON.stringify(r.argv[0]).length).toBeLessThan(1000);
  });

  test('a file with no gate context sends none', () => {
    const r = run({ questions: [codeChanges] });
    expect(r.exitCode).toBe(0);
    expect(r.sent).toEqual({ questions: [codeChanges] });
  });

  test('removes its fitted temp file after the open', () => {
    const tmp = mkdtempSync(join(dir, 'tmp-'));
    const r = run({ questions: [codeChanges] }, { TMPDIR: tmp });
    expect(r.exitCode).toBe(0);
    const sentPath = flag(r.argv[0]!, '--open-file')!;
    expect(sentPath.startsWith(tmp)).toBe(true);
    expect(existsSync(sentPath)).toBe(false);
  });

  test("passes the status-bin's failure through so degraded mode can see it", () => {
    const r = run(
      { context: 'c', questions: [codeChanges] },
      { STUB_EXIT: '3' }
    );
    expect(r.exitCode).toBe(3);
  });

  test('refuses a file that is not a gate open, without calling the status-bin', () => {
    const r = run('not json');
    expect(r.exitCode).toBe(1);
    expect(r.argv).toHaveLength(0);
    expect(run({ context: 'c' } as Open).exitCode).toBe(1);
  });

  test('usage error on the wrong argument count', () => {
    const proc = Bun.spawnSync(['sh', script, statusBin]);
    expect(proc.exitCode).toBe(2);
  });
});
