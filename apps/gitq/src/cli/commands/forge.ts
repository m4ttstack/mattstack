import { ForgeSync, type PublishNodeResult, type PublishSkip } from '../../core/forge-sync.ts';
import { GitShell } from '../../core/git-shell.ts';
import { loadStore, updateStore } from '../../core/persistence.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireStackFree } from '../slots.ts';
import { listLeases } from '../../core/leases.ts';
import { pickStack } from './crud.ts';
import { createForgeProvider } from '../provider.ts';

// ── --mr-meta parsing ────────────────────────────────────────────────────────

/**
 * Parse and validate the `--mr-meta` JSON file.
 *
 * Spec shape: `{ "<branch>": { "title": string, "description": string } }`.
 * Returns the parsed descriptions mapped to `publishStack`'s `{ title, body }`
 * shape, or an error message (never throws — callers turn the message into
 * `fail()`).
 *
 * An empty string is read as "not provided" rather than as a value to write:
 * `""` would otherwise mean branch-name-as-title on a new MR but wipe the
 * title or body of an existing one, and wiping an MR body is not something
 * this flag was designed to do. An entry that is empty on both fields drops
 * out entirely, leaving that branch's MR prose alone.
 */
export async function parseMrMeta(path: string): Promise<Record<string, { title?: string; body?: string }> | string> {
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

  const descriptions: Record<string, { title?: string; body?: string }> = {};
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
    const normalized: { title?: string; body?: string } = {};
    if (entry.title !== '') normalized.title = entry.title;
    if (entry.description !== '') normalized.body = entry.description;
    if (normalized.title !== undefined || normalized.body !== undefined) {
      descriptions[branch] = normalized;
    }
  }

  return descriptions;
}

// ── Publish output ───────────────────────────────────────────────────────────

/**
 * One human-readable line per publish result.
 *
 * Says which of the two things happened — a new MR, or an edit to one that was
 * already there — since both now come back from the same command.
 */
function formatPublishResult(r: PublishNodeResult): string {
  if (!r.success) return `${r.branch}: FAILED (${r.error})`;

  if (r.action === 'updated') {
    const changes = (r.changes ?? []).map((c) =>
      c === 'target' ? `retargeted to ${r.targetBranch}` : 'title/description',
    );
    const detail = changes.length > 0 ? ` (${changes.join(', ')})` : '';
    return `${r.branch}: updated${detail} ${r.mrUrl}`;
  }

  return `${r.branch}: created ${r.mrUrl}`;
}

/**
 * One line per branch publish would not write to.
 *
 * A skip is not a failure, but it is not a no-op either: silence here reads as
 * "that branch needed nothing", which is exactly the wrong thing to believe
 * about an MR that came back closed or unreadable.
 */
function formatPublishSkip(s: PublishSkip): string {
  return `${s.branch}: skipped (${s.detail})`;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function publishCommand(ctx: CliContext): Promise<number> {
  // Validate --mr-meta before touching the store/network: a malformed file
  // should fail the same way regardless of stack state or token presence.
  const mrMetaPath = typeof ctx.flags['mr-meta'] === 'string' ? ctx.flags['mr-meta'] : null;
  let descriptions: Record<string, { title?: string; body?: string }> | undefined;
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
  const { provider, projectPath } = await createForgeProvider(remoteUrl);

  const result = await ForgeSync.publishStack(provider, stack, projectPath, ctx.repoRoot, descriptions);

  await updateStore(ctx.repoRoot, (fresh) => ({
    ...fresh,
    remoteUrl,
    stacks: fresh.stacks.map((s) => (s.id === result.updatedStack.id ? result.updatedStack : s)),
  }));

  const ok = result.results.every((r) => r.success);
  const lines = [...result.results.map(formatPublishResult), ...result.skipped.map(formatPublishSkip)];
  const human = lines.length ? lines.join('\n') : 'nothing to publish (no branches to create or update)';
  emit(ctx, human, {
    results: result.results,
    skipped: result.skipped,
    updatedStack: result.updatedStack,
  });
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
  const { provider } = await createForgeProvider(remoteUrl);

  const { store, openMRs, scopedMRs, projectPath } = await ForgeSync.importFromForge(
    provider,
    ctx.repoRoot,
    remoteUrl,
  );
  // Import intentionally replaces the whole store (guarded above by the
  // non-empty + --replace check), not a merge with concurrent writes; the
  // callback ignores the fresh value on purpose. Still routed through
  // updateStore so the write is serialized under the same lock as every
  // other mutator instead of a bare saveStore.
  await updateStore(ctx.repoRoot, () => store);

  // "imported 0 stack(s)" reads the same whether the forge had nothing or the
  // project scope dropped everything it had, and by now --replace has already
  // taken the old store with it. A renamed or transferred project leaves a
  // remote that resolves to a project with no MRs, so say so. Written to
  // stderr: it is a diagnostic about the run, not part of --json's `{ store }`.
  if (scopedMRs === 0 && openMRs > 0) {
    console.error(
      `gitq: none of the ${openMRs} open MR(s) GitLab returned belong to ${projectPath} (read from remote ${remoteUrl}); if the project was renamed or transferred, update the remote and import again`,
    );
  }

  emit(ctx, `imported ${store.stacks.length} stack(s)`, { store });
  return 0;
}
