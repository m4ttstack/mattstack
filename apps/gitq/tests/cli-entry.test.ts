import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import pkg from '../package.json' with { type: 'json' };
import { main } from '../src/cli/main.ts';

let logged: string[];
const realLog = console.log;

beforeEach(() => {
  logged = [];
  console.log = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
});

afterEach(() => {
  console.log = realLog;
});

describe('cli entry verbs', () => {
  // The mattstack bundle gate compares this output against the deps.lock row
  // verbatim, so it is a bare semver and nothing else.
  test('--version prints bare semver', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(logged).toEqual([pkg.version]);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('help lists the command table', async () => {
    expect(await main(['--help'])).toBe(0);
    const text = logged.join('\n');
    expect(text).toContain('gitq sync');
  });
});
