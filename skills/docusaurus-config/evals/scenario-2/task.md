# Setting Up the Docusaurus Configuration for Nexus Docs

## Problem/Feature Description

The Nexus platform team has just bootstrapped a new documentation site using Docusaurus and needs a proper configuration file created before the site can go live. The site will be deployed to multiple environments (staging and production), so the production URL must not be baked directly into the config — the ops team manages it via a `SITE_URL` environment variable set in the CI/CD pipeline. A sensible fallback for local development should be included.

In addition to the standard setup, the team uses a third-party analytics provider that requires a tracking ID (`NX-2048-DOCS`) to be embedded in the site configuration. This tracking ID is not a standard Docusaurus field and must be stored somewhere it won't cause the build to fail.

The documentation site is named **"Nexus Developer Docs"**, lives at the root path, and uses the classic preset for its docs/blog/theme setup.

## Output Specification

Produce two files:

1. **`docusaurus.config.ts`** — A complete Docusaurus configuration file for the Nexus Docs site, incorporating all requirements described above.

2. **`validation-steps.md`** — A short document listing the exact shell commands and steps a developer should follow to validate the configuration after making changes, and what to do if the build fails. Write this as a numbered checklist.
