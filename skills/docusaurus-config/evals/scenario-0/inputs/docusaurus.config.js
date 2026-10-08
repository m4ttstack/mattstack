// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Acme Docs',
  url: 'https://docs.acmecorp.io/',
  baseUrl: 'docs',

  organizationName: 'acmecorp',
  projectName: 'acme-docs',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  analyticsId: 'UA-000000-2',
  supportEmail: 'support@acmecorp.io',

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
        },
        blog: {
          showReadingTime: true,
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
};

module.exports = config;
