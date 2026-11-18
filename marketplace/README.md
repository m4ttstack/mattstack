# mattstack marketplace

The first-party Claude Code plugin catalog for the
[mattstack](https://github.com/m4ttstack) estate. `rt` adds it on every
machine it sets up; anyone can add it by hand.

## Installation

Add the marketplace to Claude Code once:

```bash
claude plugin marketplace add https://github.com/m4ttstack/mattstack-marketplace
```

## Usage

Install any plugin from the catalog:

```console
$ claude plugin install mattstack@mattstack      # the mattstack skills pack
$ claude plugin install chat@mattstack           # rt chat presence skills and hooks
$ claude plugin install fast-browser@mattstack   # Chrome automation for Claude Code and Codex
$ claude plugin install superpowers@mattstack    # superpowers with task groups and Native with reviews
```

Update later with `claude plugin update <plugin>@mattstack`.

Beyond the skills, the `mattstack` pack ships a `UserPromptSubmit` +
`PostToolUse` hook that stamps each turn with local time, zone, and UTC. It
arrives with the plugin... there is nothing separate to install and no
`settings.json` edit.

## This repo is generated

Its whole tree is published from `marketplace/` in
[`m4ttstack/mattstack`](https://github.com/m4ttstack/mattstack) by
`scripts/release/marketplace.sh`, one commit per release that changes it. Edits
made here are overwritten by the next release; change the catalog in `rt`.

## Plugin sources

The `mattstack` and `chat` plugins publish from this repository's tree
(`plugins/mattstack`, `marketplace/plugins/chat`). `fast-browser` and
`superpowers` (mattstack's fork of
[obra/superpowers](https://github.com/obra/superpowers), pinned from its
`mattstack` branch) are pinned URL sources. A plugin in its own repo is
**pinned to a commit**, so a given catalog commit always installs the same
plugin code:

```json
"source": { "source": "url", "url": "https://github.com/…", "ref": "main", "sha": "<commit>" }
```

Claude Code resolves `sha`. `ref` records which branch the pin came from, so
`marketplace.sh --refresh` can re-resolve it; bumping a pin is a reviewed commit
in `rt`, never an implicit follow-the-branch.

## License

[MIT](LICENSE)
