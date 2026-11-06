/**
 * Bun compiles the entrypoint itself into its virtual filesystem, at
 * `/$bunfs/root/<binary-name>` -- verified empirically (`bun build
 * --compile`, then run: `Bun.main` carries that prefix; `bun run` of the
 * same source does not). This holds even with zero `with { type: 'file' }`
 * imports anywhere in the build, which is exactly why it's used here rather
 * than `Bun.embeddedFiles`: that array reads empty both when nothing got
 * embedded AND when the process isn't compiled at all, so it can't tell
 * "compiled binary, codegen didn't run" apart from "not compiled" -- the one
 * distinction this needs.
 */
export function isCompiledBinaryMain(main: string): boolean {
  return main.startsWith('/$bunfs/');
}

/** `bun build --define MATTSTACK_HELPER_BUNDLE=true` sets it for the bundle
    the app's Helpers launcher runs; it is undeclared everywhere else. */
declare const MATTSTACK_HELPER_BUNDLE: boolean | undefined;

export function isHelperBundle(): boolean {
  return (
    typeof MATTSTACK_HELPER_BUNDLE !== 'undefined' &&
    MATTSTACK_HELPER_BUNDLE === true
  );
}

/** True for both distributed forms: there is no `dist/` beside either one to
    fall back to. Bun-touching -- exercised by actually running the build,
    not vitest (no `Bun` global there). */
export function isCompiledBinary(): boolean {
  return isHelperBundle() || isCompiledBinaryMain(Bun.main);
}
