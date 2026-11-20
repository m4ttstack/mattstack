The rt daemon now publishes its REST API as an OpenAPI document with browsable docs, and it stays responsive under slow scans and busy clients. VS Code gets an agents menu, and `rt pane attach` jumps into a Claude agent's terminal. Every mattstack Mac now shares the same Claude Code rules.

### rt and the daemon

- the daemon serves its REST API as `/openapi.json`, with browsable docs at `/docs` and a generated index; requests now route through Hono (#1196, #1198)
- the daemon's API docs use short route titles, with details in the descriptions and keyed examples
- clients and slow scans no longer stall the daemon (#1185)
- idle daemons stop scanning: runaway-process detection is gone (#1190)
- `rt pane attach` picks one of your Claude agents and jumps into its terminal, with bare agent names, a wrapped preview folder and visible rules (#1183, #1188)
- `rt code` saves the workspace-file choice per repo, and only for VS Code-family editors (#1184)
- every rt picker shares one worktree order, and the new `rt.linearKey` setting names which Linear key a repo's tickets are looked up with (#1195)

### Setup

- shared Claude Code rules are linked into every Claude config dir on every mattstack Mac, and kept current on each update and org pull (#1186)
- gate-form and human-todos stay current like the other baseline plugins (#1187)

### VS Code

- the status bar has an **Agents** menu that attaches to this worktree's live and finished Claude sessions (#1192)
- the worktree picker shows `rt cd`'s order and groups, and a PR or MR title when a row has no ticket title (#1195)

### Console

- **Changes** shows each commit's author on its own line, and usage step rows sit on the card (#1199)
- the usage MR list opens on Last active, and its sort arrow keeps its full size

### Skills and plugins

- self-review no longer fails the unbound path on an optional nit (#1182)
- the worktree-leave hook's Close drops the worktree session before exiting, so Claude Code no longer asks whether to keep or remove it

### App and CI

- glitter logs every failed remote action to the CLI log (#1189)
- the tray panel's notification names are restored (#1191)
- CI compiles the tray app on PRs that touch it (#1193)

### Docs

- a Lore pointer page on the Skills tab (#1194)

### Held

- bun stays at 1.4.4 (1.4.5 is out).
- Sparkle stays at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release.

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.33.0...v2.34.0
