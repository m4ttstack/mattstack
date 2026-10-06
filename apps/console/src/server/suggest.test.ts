// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { suggestValues, type SuggestDeps } from './suggest';

function deps(
  settings: Record<string, unknown>,
  sections: Record<string, string[] | null>
): SuggestDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    setting: <T>(key: string) => settings[key] as T | undefined,
    knownSections: async id => {
      asked.push(id);
      return sections[id] ?? null;
    },
  };
}

describe('codeowners-sections', () => {
  it("unions every board project's known sections, sorted", async () => {
    const d = deps(
      {
        'board.gitlabHost': 'https://GitLab.example.com/',
        'board.projects': ['acme/web', 'acme/api'],
      },
      {
        'remote:gitlab.example.com%2Facme%2Fweb': ['Web', 'Docs'],
        'remote:gitlab.example.com%2Facme%2Fapi': ['API', 'Docs'],
      }
    );
    expect(await suggestValues('codeowners-sections', d)).toEqual([
      'API',
      'Docs',
      'Web',
    ]);
    expect(d.asked).toEqual([
      'remote:gitlab.example.com%2Facme%2Fweb',
      'remote:gitlab.example.com%2Facme%2Fapi',
    ]);
  });

  it('is null, not empty, when rt has nothing for any project yet', async () => {
    const d = deps(
      {
        'board.gitlabHost': 'gitlab.example.com',
        'board.projects': ['acme/web'],
      },
      {}
    );
    expect(await suggestValues('codeowners-sections', d)).toBeNull();
  });

  it('is null with no board projects', async () => {
    expect(await suggestValues('codeowners-sections', deps({}, {}))).toBeNull();
  });
});

it('an unknown list is undefined, which the route answers 404', async () => {
  expect(await suggestValues('nope', deps({}, {}))).toBeUndefined();
});
