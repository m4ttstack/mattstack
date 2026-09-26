import { describe, test, expect } from 'bun:test';
import { COMMANDS, USAGE, helpText } from '../src/cli/main.ts';

describe('cli help', () => {
  test('every command has a usage line', () => {
    const missing = Object.keys(COMMANDS).filter((name) => !(name in USAGE));
    expect(missing, `commands with no entry in USAGE: ${missing.join(', ')}`).toEqual([]);
  });

  test('every usage line names a real command', () => {
    const orphans = Object.keys(USAGE).filter((name) => !(name in COMMANDS));
    expect(orphans, `usage lines for commands that no longer exist: ${orphans.join(', ')}`).toEqual([]);
  });

  test('each usage line opens with its own command name', () => {
    const wrong = Object.entries(USAGE).filter(([name, line]) => !line.startsWith(`gitq ${name}`));
    expect(wrong.map(([name]) => name)).toEqual([]);
  });

  test('helpText() with no command lists every command', () => {
    const text = helpText();
    const missing = Object.keys(COMMANDS).filter((name) => !text.includes(name));
    expect(missing).toEqual([]);
  });

  test('helpText(command) shows that command and not the whole table', () => {
    const text = helpText('absorb');
    expect(text).toContain('gitq absorb');
    expect(text).toContain('--preview');
    expect(text).not.toContain('gitq reparent');
  });
});
