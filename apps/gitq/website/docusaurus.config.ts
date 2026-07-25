import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "gitq",
  tagline: "A deterministic stacked branch engine and CLI for git",
  favicon: "img/favicon.svg",
  url: "https://m4ttheweric.github.io",
  // "/gitq/" is the GitHub Pages project-site path. The local service builds
  // with DOCS_BASE_URL=/ because it serves the site at its own domain root.
  baseUrl: process.env.DOCS_BASE_URL ?? "/gitq/",
  organizationName: "m4ttheweric",
  projectName: "gitq",
  trailingSlash: false,
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  themes: ["@docusaurus/theme-mermaid"],
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/m4ttheweric/gitq/tree/main/website/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "gitq",
      items: [
        {
          href: "https://github.com/m4ttheweric/gitq",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [],
      copyright: "gitq ... stacked branches without the bookkeeping",
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "diff"],
    },
    colorMode: { defaultMode: "light", respectPrefersColorScheme: true },
  } satisfies Preset.ThemeConfig,
};

export default config;
