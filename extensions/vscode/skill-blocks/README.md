# Skill Blocks

A thin VS Code client for `rt skills lsp`: diagnostics, hover, go to definition, completion, references, rename and quick fixes for `*.block.md` files, `skills.jsonc` manifests and the fill markdown they bind.

The extension carries no logic of its own. It launches `rt skills lsp` over stdio.

## Install

```sh
bun run package
code --install-extension skill-blocks-0.1.0.vsix
```

`bun run package` builds the bundle and runs `vsce`. Cursor and Antigravity install the same `.vsix` with their own `--install-extension`.

## Setting

`skillBlocks.rtPath` is the `rt` executable (default `rt`). At the default, the extension looks for `rt` on the editor's PATH, then at `~/.local/bin/rt`.

## Command

`Skill Blocks: Restart Server` restarts the language server.
