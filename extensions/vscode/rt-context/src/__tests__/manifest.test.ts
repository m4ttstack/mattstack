import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'));

describe('manifest', () => {
  test('the GitLab token command is hidden from the palette on GitHub repos', () => {
    expect(manifest.contributes.menus.commandPalette).toContainEqual({
      command: 'rtContext.setGitlabToken',
      when: "rtContext.forge != 'github'",
    });
  });
});
