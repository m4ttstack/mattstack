import tseslint from 'typescript-eslint';

import { importWall, mattstackEslint } from '@mattstack/app-kit/eslint';

// Tests never reach the browser bundle, so they may import the pure-TS server
// fixture; every other wall still applies to them.
const testImportWall = {
  ...importWall,
  patterns: importWall.patterns.filter(
    p => !p.group.includes('**/server/**')
  ),
};

export default tseslint.config(...mattstackEslint(), {
  files: ['src/**/*.test.{ts,tsx}'],
  rules: { 'no-restricted-imports': ['error', testImportWall] },
});
