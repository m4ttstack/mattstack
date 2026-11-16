import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'));
const extensionSource = readFileSync(join(import.meta.dir, '..', 'extension.ts'), 'utf8');
const commands: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);

describe('manifest', () => {
  test('every contributed command is registered', () => {
    for (const command of commands) expect(extensionSource).toContain(`registerCommand('${command}'`);
  });

  test('offers no token commands: tokens are set with rt secrets set', () => {
    expect(commands.filter((c) => /token|apikey/i.test(c))).toEqual([]);
  });
});
