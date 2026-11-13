# Mod kit and mod build pipeline

## Why

Matt wants to build more Claude Code mods, and he does not want to rebuild the
same UI for each one. The gate-form spike (`plugins/gate-form/`, branch
`gate-form-spike`) produced a clack-styled UI he likes: buttons, lists, tabs, a
header bar, a hide-and-reopen band, hover and press states. Today that UI lives
inside one mod. The goal is one shared kit that every mod uses, so a new mod
writes only its own content and every mod looks and behaves the same.

## Goals

- A shared kit package that holds every reusable UI piece and pattern from the
  spike, including the hook-side patterns, not just the drawing widgets.
- Mods written as normal TypeScript packages that import the kit, with a build
  step that turns each one into the self-contained plugin folder Claude Code
  reads.
- A live catalog of every kit piece in every state, plus a short README of its
  API.
- gate-form moved onto the pipeline and the kit, behaving exactly as it does
  on the spike branch.

## Non-goals

- Moving human-todos onto the kit. That is the follow-up, once the kit has
  settled against gate-form.
- Wiring gate-form to the real gate registry or redirecting AskUserQuestion.
- Light-terminal colours. The palette stays dark-only for now.
- Publishing the kit to npm.

## Anti-goals

- A kit that still makes a mod author hand-wire hover, press, focus or the
  reopen band. If a new mod has to copy that code, the kit failed.
- Built plugin output that drifts from source without CI noticing.
- A gallery drawn from anything but the real kit code.

## Constraints (learned in the spike)

- A mod's modules may import only the mod's own files, so shared code must be
  inlined into each mod at build time.
- Client surface modules (the drawing code) have no access to `$`; the hooks
  module does. Client modules are named by a string-literal `module` path on the
  `Client` element.
- Claude Code reads the hooks module's source statically before running it:
  - `register` must be a top-level function declaration
    (`export function register(on)`); `export const register = on => ...`
    fails once bundled.
  - A function that receives `$` must be declared at the top of the same file.
    Bundling inlines kit helpers into that file, which satisfies this.
  - `atom({ plugin: '<name>', key: ... })` refs must be literals.
  - Matcher values the validator should read must be literals in the output;
    the bundler turns top-level `const` into `var`, which the validator reports
    as `?` (it still works at run time).
  - `import()` anywhere stops the module loading.
- `claude plugin test` fails on a mod with no `*.test.ts(x)`.
- `scripts/__tests__/no-plugin-ci-jobs.test.ts` requires a `plugin-<name>` CI job
  for every folder under `plugins/`.
- The probe on 2026-11-12 showed `bun build` (ESM, `target: 'browser'`,
  `external: ['claude-code']`, no splitting, no minify, the mod tsconfig's JSX
  factory `h`) produces a gate-form that validates and passes its tests, once
  `register` is a function declaration and Client paths are rewritten.

## Approaches considered

1. **One kit source, copied into each mod by a sync script, CI drift check.**
   Works today, but copies sit in every mod, and hook-side patterns still hit
   the `$` rule across files.
2. **A kit plugin other mods depend on (`$.kit`).** Shares only the hook side;
   Client drawing code cannot reach `$`, so widgets would still be copied.
3. **A new-mod template.** Every copy drifts from the moment it is made.
4. **Source packages plus a build step (picked).** Mods and the kit are normal
   packages; a build bundles each mod's entry points into self-contained files
   in the plugin folder. Matt proposed it: author in a Node-like environment,
   compile to what Claude reads. It removes copying, lets hook-side patterns
   live in the kit, and allows ordinary pure npm dependencies.

## Decided

- **Approach 4.** (Matt)
- **Built output is committed** to `plugins/<name>/`, and CI fails when a build
  would change it, like the compiled-skill freshness check. Marketplace and git
  installs keep working unchanged. (Matt)
- **Catalog = live gallery + README.** A `/kit-gallery` command opens a pane
  that draws every piece in every state with the real kit code; a README covers
  each piece's API. (Matt)
- **First project scope:** pipeline, kit package, gate-form moved over, gallery,
  README. human-todos follows separately. (Matt)
- **It lands on `main` through the merge queue.** The CI scoping for `mods/` and
  `packages/mod-kit` (`scripts/ci/test-scope.ts`, the `checks` job's needs) is
  part of the project. gate-form stays out of `marketplace/marketplace.json`
  until it is wired to real gates. (Matt)

## Layout (my call)

```
packages/mod-kit/            @mattstack/mod-kit (private workspace package)
  src/draw/                  text (spans, lines, wrap, hang, hit testing), theme, render
  src/widgets/               brandBar, selectList, inputField, textCursor, tabStrip,
                             buttons (tones + disabled), scroll chips
  src/interact/              Client pointer controller (hover, press-on-release,
                             drag-off cancel, click-to-focus), focus stand-in
  src/patterns/              hideable pane + reopen band, transcript summary line,
                             page shell (fixed height, nav row, review page)
  README.md
mods/<name>/                 a mod's source package
  src/register.tsx           hooks module entry
  src/<client>.tsx           one file per Client module
  src/**/*.test.tsx          mod tests
  mod.json                   plugin.json fields + the list of Client entry points
plugins/<name>/              built output, committed (what Claude Code reads)
scripts/mods/build.ts        the build
```

`mods/*` joins the root `workspaces`. The kit is not `packages/tui-kit` (that
one serves the Ink apps); mod elements come from Claude Code's own table.

## The kit (my calls)

Everything in the spike's `hooks/kit/` moves in, plus what the spike wired by
hand in gate-form:

| Piece | From | Notes |
|---|---|---|
| Look: clack symbols, Nerd Font icons (codepoints verified against the installed font), brand pink/plum/pinkDeep, `FILL` tones (primary, secondary, neutral, caution, brand, chip, current, disabled, field), hover and press shades, unfocused muting | `kit/theme.ts` | Dark-only. |
| Text model: spans and lines carrying click actions, wrap, hanging indent, hit testing, hover keys that include the row | `kit/text.ts` | |
| Render: lines to `Text`, hover/pressed/unfocused styling | `kit/render.tsx` | |
| Widgets: `brandBar` (optional Hide), `selectList` (single, multi, 2-row options, write-in "Something else" with a filled input, windowing), `inputField`, `textCursor`, `tabStrip` (sticky window, one-tab scroll chips at fixed width), `buttonRow` / `buttonSpan` (five tones plus disabled) | `kit/widgets.ts` | |
| Pointer controller for a Client: hover, press on down and act on release over the same control, drag-off cancel, first click on a dimmed surface only focuses, posts an "engaged" message | `form.tsx`, `band.tsx` | Today duplicated; becomes one helper. |
| Focus stand-in: a per-mod atom set by the Client's "engaged" post, cleared by `prompt.edit`, `prompt.submit` and `ui.focus`; combined with the pane's `isFocused` | `register.tsx` | Claude Code has no Client focus signal. |
| Hideable pane: open/show, a Hide control in the brand bar, a reopen band above the prompt (a Client with the brand Open button, falling back to the engine `Button` on surfaces without Client), `ui.close` redraw | `register.tsx`, `band.tsx` | The engine's own `×` cannot be hidden; it behaves like Hide. |
| Transcript summary: a `UserMessage` hook that rewrites a plugin's message text to one line, leaving the stored message whole | `register.tsx` | Rewrite the text and pass to `next`; returning a custom tree was not drawn. Unverified on screen; see open risks. |
| Page shell: pad pages to the tallest page so buttons keep their row, drop context first on overflow, the Back (disabled on page 1) / Next / Review / Submit row, the press-again confirm button, a review list whose entries are clickable | `form/view.ts` | Generic enough for any paged surface. |

Form-specific logic (gate questions, `gate_answer` shapes, Next semantics where
a single choice's cursor counts only when recommended, moved or answered) stays
in `mods/gate-form/`.

How a mod registers a kit pattern is left to the builder, with one rule: hook
helpers take `on` (for example `registerHideablePane(on, { ... })`) or are
called inside the mod's own hooks; they are inlined at build, so the `$` rule
holds.

## The build (my calls)

`bun run mods:build [name]` and `bun run mods:watch <name>`:

- Bundles `src/register.tsx` and each Client entry listed in `mod.json`, one
  output file each, with the settings the probe used.
- Writes `hooks/hooks.json`, `.claude-plugin/plugin.json` (from `mod.json`), and
  copies `types/` and any mod assets.
- Rewrites each Client `module` path to its built file name.
- Keeps validator-readable literals: either the build inlines top-level
  constant strings used in matchers, or a lint in the build fails on a matcher
  that is not a literal. Builder's choice.
- Fails if the output contains `import(`.
- Runs `claude plugin validate` on the output and fails on errors.
- `mods:watch <name>` builds into the session's dev-mods folder for hot reload;
  the folder is an argument because each session has its own.

CI:

- A freshness job: build every mod and fail if `plugins/` changes (mirrors the
  compiled-skill check).
- Each `plugin-<name>` job runs `claude plugin test` and `claude plugin validate`
  on the built folder, as `plugin-gate-form` does now.
- Tests (my call): the pure kit pieces (text, theme, widgets, page-shell layout)
  get plain bun unit tests in `packages/mod-kit`, run in CI. The pieces that
  need `claude-code` or the `claude-code/testing` harness (pointer controller,
  focus stand-in, hideable pane, transcript summary, render) are tested through
  `claude plugin test` in the `kit-gallery` mod, whose job is to exercise every
  kit piece anyway.
- Types (my call): kit and mod source is type-checked in CI. Claude Code writes
  its `claude-code` declarations into a plugin folder only when it loads it, so
  the repo commits a copy generated by the CLI version CI pins (2.1.322 today),
  with a script that refreshes it from that CLI. `packages/mod-kit` and `mods/*`
  type-check against that copy.

## The gallery (my call)

A `/kit-gallery` command, shipped as its own small mod built by the same
pipeline (`mods/kit-gallery/`), so it exercises the build too. It opens a pane
that draws, labelled, with real kit code:

- every button tone at rest, hover, pressed, disabled, and unfocused
- the brand bar with and without Hide
- `selectList` single and multi, with and without descriptions, the write-in
  empty, focused and filled, and a windowed list with "↑ N more"
- `inputField` empty and filled; `tabStrip` short, overflowing, scrolled
- the reopen band
- the page shell with its nav row

Hover and press in the gallery are live, through the same pointer controller.
Unfocused variants are drawn side by side rather than toggled.

## README

`packages/mod-kit/README.md`: one short section per piece (what it is, its
signature, one example), the rules from Constraints written for mod authors,
and how to start a new mod (`mods/<name>/`, `mod.json`, `mods:watch`).

## Moving gate-form

- Source moves from `plugins/gate-form/hooks/` to `mods/gate-form/src/`; its
  `kit/` folder is deleted in favour of the package.
- `plugins/gate-form/` becomes build output.
- Behaviour must match the spike branch at commit `2f04ad07f` and the live
  dev-mods copy, including every change listed under "the kit" above.
- Its existing transcript test keeps passing against the built folder.

## Open risks

- The transcript text rewrite passes its mod test but has not been seen working
  in a real transcript. Matt checks it live before merge. If the row still shows
  the full answers, the summary piece ships out of the kit and gate-form for
  now, and a working approach becomes a follow-up; it does not block the
  project. (Matt)
- The bundle probe covered gate-form only. The freshness check and validator
  run in the build are the guard for other mods.

## Left to the builder

- Exact kit module names and function signatures within the layout above.
- How the build keeps matcher values literal (inline or lint).
- Whether kit tests join `bun run test` or get their own script, as long as CI
  runs them.
- The gallery's layout.
