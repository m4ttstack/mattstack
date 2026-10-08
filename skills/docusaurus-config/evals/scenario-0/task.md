# Fix the Acme Docs Docusaurus Configuration

## Problem/Feature Description

The Acme Corp documentation team recently inherited a Docusaurus site from a contractor. The site was deploying fine in the contractor's local environment, but the team is now seeing a cascade of validation errors whenever they try to build or deploy it. Someone on the team made a few quick edits to `docusaurus.config.js` to add some analytics and support contact details, and now the build is completely broken.

The team suspects the config file has multiple issues — some pre-existing and some introduced recently — but they're not sure exactly what is wrong. They need the configuration fixed so it passes Docusaurus's own validation checks and the site can be built cleanly.

## Output Specification

- Read the broken config at `inputs/docusaurus.config.js`.
- Produce a corrected version saved as `docusaurus.config.js` in your working directory (do **not** overwrite the input file).
- The corrected file must be valid JavaScript in the same CommonJS format as the original — do not convert it to TypeScript or ESM.
- No need to actually run a build; the grader will inspect the corrected file directly.
