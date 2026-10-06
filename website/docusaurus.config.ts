import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "mattstack",
  tagline: "An agentic application stack for engineers.",
  favicon: "img/favicon.svg",
  url: "https://docs.mattstack.dev",
  baseUrl: "/",
  organizationName: "m4ttstack",
  projectName: "mattstack",
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
          editUrl: "https://github.com/m4ttstack/mattstack/tree/main/website/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "mattstack",
      items: [
        { type: "docSidebar", sidebarId: "start", label: "Get started", position: "left" },
        { type: "docSidebar", sidebarId: "apps", label: "Apps", position: "left" },
        { type: "docSidebar", sidebarId: "rt", label: "rt CLI", position: "left" },
        { type: "docSidebar", sidebarId: "gitq", label: "gitq", position: "left" },
        { type: "docSidebar", sidebarId: "skills", label: "Skills", position: "left" },
        { href: "https://github.com/m4ttstack/mattstack", label: "GitHub", position: "right" },
        { href: "https://github.com/m4ttstack/mattstack/releases", label: "Releases", position: "right" },
        { href: "https://github.com/m4ttstack/mattstack/releases/latest", label: "Download", position: "right", className: "nav-dl" },
      ],
    },
    footer: {
      style: "dark",
      links: [],
      copyright: "mattstack",
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
