import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  viteFinal: async viteConfig => {
    const stub = fileURLToPath(
      new URL('./node-crypto-stub.ts', import.meta.url)
    );
    const alias = viteConfig.resolve?.alias;
    const entries = Array.isArray(alias)
      ? alias
      : Object.entries(alias ?? {}).map(([find, replacement]) => ({
          find,
          replacement: replacement as string,
        }));
    return {
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        alias: [...entries, { find: 'node:crypto', replacement: stub }],
      },
    };
  },
  stories: [
    '../stories/**/*.mdx',
    '../stories/**/*.stories.@(ts|tsx)',
    '../packages/ui/src/**/*.mdx',
    '../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../apps/console/src/**/*.stories.@(ts|tsx)',
    '../apps/board/src/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
  ],
  framework: '@storybook/react-vite',
};
export default config;
