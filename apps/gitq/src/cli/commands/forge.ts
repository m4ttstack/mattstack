import { ForgeSync } from '../../core/forge-sync.ts';
import { GitShell } from '../../core/git-shell.ts';
import { loadStore, updateStore } from '../../core/persistence.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireStackFree } from '../slots.ts';
import { listLeases } from '../../core/leases.ts';
import { pickStack } from './crud.ts';
import { createGitLabProvider } from '../provider.ts';

// ── --mr-meta parsing ────────────────────────────────────────────────────────

/**
 * Parse and validate the `--mr-meta` JSON file.
 *
 * Spec shape: `{ "<branch>": { "title": string, "description": string } }`.
 * Returns the parsed descriptions mapped to `publishStack`'s `{ title, body }`
 * shape, or an error message (never throws — callers turn the message into
 * `fail()`).
 */
async function parseMrMeta(path: string): Promise<Record<string, { title: string; body: string }> | string> {
  let raw: string;
  try {
    raw = await Bun.file(path).text();
  } catch {
    return `invalid --mr-meta: cannot read ${path}`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `invalid --mr-meta: ${path} is not valid JSON`;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'invalid --mr-meta: expected a JSON object of {branch: {title, description}}';
  }

  const descriptions: Record<string, { title: string; body: string }> = {};
  for (const [branch, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as Record<string, unknown>).title !== 'string' ||
      typeof (value as Record<string, unknown>).description !== 'string'
    ) {
      return `invalid --mr-meta: entry "${branch}" must be {"title": string, "description": string}`;
    }
    const entry = value as { title: string; description: string };
    descriptions[branch] = { title: entry.title, body: entry.description };
  }

  return descriptions;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function publishCommand(ctx: CliContext): Promise<number> {
  // Validate --mr-meta before touching the store/network: a malformed file
  // should fail the same way regardless of stack state or token presence.
  const mrMetaPath = typeof ctx.flags['mr-meta'] === 'string' ? ctx.flags['mr-meta'] : null;
  let descriptions: Record<string, { title: string; body: string }> | undefined;
  if (mrMetaPath) {
    const result = await parseMrMeta(mrMetaPath);
    if (typeof result === 'string') return fail(result);
    descriptions = result;
  }

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  const remoteUrl = store.remoteUrl || (await GitShell.getRemoteUrl(ctx.repoRoot));
  const { provider, projectPath } = createGitLabProvider(remoteUrl);

  const result = await ForgeSync.publishStack(provider, stack, projectPath, ctx.repoRoot, descriptions);

  await updateStore(ctx.repoRoot, (fresh) => ({
    ...fresh,
    remoteUrl,
    stacks: fresh.stacks.map((s) => (s.id === result.updatedStack.id ? result.updatedStack : s)),
  }));

  const ok = result.results.every((r) => r.success);
  const human = result.results.length
    ? result.results.map((r) => (r.success ? `${r.branch}: ${r.mrUrl}` : `${r.branch}: FAILED (${r.error})`)).join('\n')
    : 'nothing to publish (no local-only branches)';
  emit(ctx, human, { results: result.results, updatedStack: result.updatedStack });
  return ok ? 0 : 1;
}

export async function importCommand(ctx: CliContext): Promise<number> {
  // Import has no single stack to guard (it replaces the whole store), so
  // refuse outright when any cascade is active anywhere in the repo.
  if ((await listLeases(ctx.commonDir)).length > 0) {
    return fail('cascades are active; finish or abort them first');
  }

  // Import rebuilds the local store from scratch — replacing every tracked
  // stack and re-minting their ids. Refuse to clobber a non-empty store unless
  // --replace is given. Check this BEFORE resolving the provider/token so the
  // guard works offline (no token needed to be told what would be lost).
  const existing = await loadStore(ctx.repoRoot);
  const replace = ctx.flags.replace === true;
  if (existing.stacks.length > 0 && !replace) {
    return fail(
      `import would discard ${existing.stacks.length} locally tracked stack(s) and re-mint stack ids; pass --replace to overwrite the local store`,
    );
  }

  const remoteUrl = await GitShell.getRemoteUrl(ctx.repoRoot);
  const { provider } = createGitLabProvider(remoteUrl);

  const store = await ForgeSync.importFromForge(provider, ctx.repoRoot, remoteUrl);
  // Import intentionally replaces the whole store (guarded above by the
  // non-empty + --replace check), not a merge with concurrent writes; the
  // callback ignores the fresh value on purpose. Still routed through
  // updateStore so the write is serialized under the same lock as every
  // other mutator instead of a bare saveStore.
  await updateStore(ctx.repoRoot, () => store);

  emit(ctx, `imported ${store.stacks.length} stack(s)`, { store });
  return 0;
}
