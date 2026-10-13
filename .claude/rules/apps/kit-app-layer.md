---
paths:
  - "packages/ui/src/app/**"
  - "packages/ui/src/router/**"
  - "packages/ui/src/boot/**"
  - "apps/{chat,console,boxscore}/index.html"
  - "apps/{chat,console,boxscore}/src/app/**"
---

# Kit contract: boot and the mattstack layer

## 7. Boot family contract

`index.html` inlines a static loading-bar `<style>` block directly in
`<head>`, so it paints the instant the browser has the HTML document --
before the module script is fetched/parsed/executed, before React exists.
`mountMattstackApp`'s render replaces `#root`'s entire subtree (this
markup included) the moment React actually mounts.

That inline block exists in two copies: the copy actually served at
runtime in the consuming app's own `index.html`, and the package's
`@mattstack/app-kit/boot/simple-loading-bar.css` (a reviewable, lintable
reference; not itself linked/loaded). Both wrap the shared rules in
matching markers:

```
/* BEGIN SYNCED RULES: keep in sync with @mattstack/app-kit/boot/simple-loading-bar.css (see expectLoadingBarInSync) */
...
/* END SYNCED RULES */
```

The two-file sync contract has a clear owner on each side: the package
owns the stylesheet, and the app owns `index.html` plus a one-line
`loading-bar-sync.test.ts` calling
`expectLoadingBarInSync(readFileSync('index.html', 'utf-8'))` (see
`apps/chat/src/loading-bar-sync.test.ts`). `expectLoadingBarInSync`
(`@mattstack/app-kit/test-utils`) reads both files off disk at test time
and extracts the block between the markers from the package's OWN
stylesheet -- no string constant to drift -- so the check runs in every
app against the package version it actually installed.

`registerSimpleAlerts`/`markMounted` (`@mattstack/app-kit/boot`) is the
last-resort, dependency-free (no React, no Mantine) fatal-error safety net
for the window before React has mounted. `mountMattstackApp` wires it up
in the exact required order internally: `registerSimpleAlerts()` before
the render call, `markMounted()` only reached if render did not throw. A
consumer calling `mountMattstackApp` gets this for free and never reorders
the three steps by hand.

## 8. The mattstack layer

`packages/ui/src/app/` (exported as `@mattstack/app-kit/app`) and
`packages/ui/src/router/` (`@mattstack/app-kit/router`) are the
whitelabeled shell + boot + router glue every mattstack app shares, on top
of the generic kit in sections 1-7.

**`app`**: `mountMattstackApp(node, opts?)` renders `StrictMode >
MantineProvider(theme merged with opts.theme, defaultColorScheme "auto") >
ModalsProvider > node + Notifications`, brackets the render with the boot
family (§7), and imports `./styles.css` (pulling in the Tokyo CSS) as a
side effect of the module. Target element is `#root`.

`MattstackShell` owns the `RailShell` wiring, `useRailState`, the
translucent header, the mark + wordmark recipe, and the colour-scheme
control pinned to the rail bottom (`HybridMenu`'s three-way System /
Light / Dark). `Rail` and `RailBottom` are compound statics attached with
`/* @__PURE__ */ Object.assign`, per §2's tree-shake rules:

```tsx
<MattstackShell name="chat" mark={<AppMark size={30} />}>
  <MattstackShell.Rail>
    <RailLink icon="users" label="Rooms" href="/" active />
  </MattstackShell.Rail>
  <MattstackShell.RailBottom>
    {/* optional, above the scheme control */}
  </MattstackShell.RailBottom>
  {children}
</MattstackShell>
```

A one-page app passes `rail={false}`; `docs/apps/ui-authoring.md` says
when each mode applies and what the kit draws in each.
`MattstackShell.Header` is written as a direct child of `MattstackShell`.
Rail and RailBottom children are dropped under `rail={false}` (a
development build warns).

```tsx
<MattstackShell name="boxscore" mark={<AppMark size={30} />} rail={false}>
  <MattstackShell.Header actions={<RefreshButton />}>
    <Crumbs />
  </MattstackShell.Header>
  {children}
</MattstackShell>
```

`DaemonBanner` is a presentational component; `useDaemonHealth(seed?:
boolean)` polls `/api/daemon` (the route `@mattstack/app-server` mounts,
see below) and returns `{ reachable, downSince, probeCount,
lastAnsweredAt, probeNow }`. `seed` is the initial `reachable` value, kept
so a consuming app's own test can drive the daemon's starting state
through an `initialState` prop the app itself defines. `NotFoundPage`
takes `home` (default `/`).

**`router`**: `RailLink` renders `RailEntry` through wouter's `Link`
(`href`, `active`, closes the rail on click via shell context). `Link` is
wouter's, re-exported so apps have one door. `useHash()` is
`useLocationProperty(() => window.location.hash)`.

**The `AppIcons` augmentation contract**: `registerIcons({ hash:
lucideWrapperFn(Hash) })` at boot, plus `declare module
'@mattstack/app-kit/icons' { interface AppIcons { hash: true } }` in the
app's own `.d.ts`, extends the closed `IconName` union with the app's
registration. `Icon` reads a module-level registry; registration before
first render is the contract, and registering a key the kit already has
throws. The registration file is the one sanctioned place outside the
kit's own `Icons.ts` where an app may
`eslint-disable-next-line no-restricted-imports` to import `lucide-react`
directly, e.g. `apps/chat/src/app/icons.ts:4`. See "Consumer requirements"
below for the one real trap in writing that `.d.ts` file.

**Theme extension**: `mountMattstackApp(node, { theme })` merges on top of
Tokyo (see §4 for why this is the ONLY per-app theme extension point in
this repo, unlike mantine-kit's `app-theme.ts`). Lazy loaders (heavy
dependencies like CodeMirror) get a loader in the package, never in an
app, so vendor splitting has one owner.
