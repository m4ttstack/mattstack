/**
 * lib/agent-argv/env.ts ... environment a worker must not inherit. A pane
 * shell takes whatever its herdr server holds, so a variable that names
 * another harness's session is unset on the pane line before the harness
 * starts; a spawned process simply has it left out.
 */

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `unset A B && `, or nothing when there is nothing to clear. Names are never quoted, so only shell identifiers pass. */
export function unsetPrefix(names: readonly string[] | undefined): string {
  if (!names || names.length === 0) return "";
  const bad = names.find((name) => !ENV_NAME_RE.test(name));
  if (bad !== undefined) throw new Error(`invalid environment variable name "${bad}" ... refusing to build the pane command`);
  return `unset ${names.join(" ")} && `;
}

/** A copy of `env` without `names`. */
export function withoutEnv<T extends Record<string, string | undefined>>(env: T, names: readonly string[] | undefined): T {
  if (!names || names.length === 0) return env;
  const out = { ...env };
  for (const name of names) delete out[name];
  return out;
}
