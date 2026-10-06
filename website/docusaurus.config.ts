import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "mattstack",
  tagline: "An agentic application stack for engineers.",
  favicon: "img/app-icon.png",
  headTags: [
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" } },
    {
      tagName: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    },
  ],
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
      logo: { alt: "", src: "img/app-icon.png", width: 26, height: 26 },
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
      style: "light",
      links: [
        { label: "mattstack.dev", href: "https://mattstack.dev" },
        { label: "GitHub", href: "https://github.com/m4ttstack/mattstack" },
        { label: "Releases", href: "https://github.com/m4ttstack/mattstack/releases" },
      ],
      copyright: "mattstack",
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["bash", "json", "diff"],
    },
    colorMode: { respectPrefersColorScheme: true },
    mermaid: {
      theme: { light: "neutral", dark: "dark" },
      options: { fontFamily: "Inter, system-ui, -apple-system, \"Segoe UI\", Helvetica, sans-serif" },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
