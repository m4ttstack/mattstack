import { GitShell } from './git-shell.ts';
import { StackError } from './stack-manager.ts';

const DIRTY_TREE_MSG = 'Working tree has uncommitted changes. Commit or stash first.';

/** Throw a StackError if the working tree has uncommitted changes. */
export async function assertCleanTree(cwd: string): Promise<void> {
  if (await GitShell.isDirty(cwd)) {
    throw new StackError(DIRTY_TREE_MSG);
  }
}
