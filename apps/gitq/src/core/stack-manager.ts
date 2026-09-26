import type { Stack, StackNode, StackNodeStatus } from './types.ts';

// ── Errors ───────────────────────────────────────────────────────────────────

export class StackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackError';
  }
}

// ── Default node factory ─────────────────────────────────────────────────────

function createNode(branch: string, parent: string): StackNode {
  return {
    branch,
    parent,
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    status: 'local-only',
    lastKnownHead: null,
    forkPoint: null,
    diffStats: null,
    pipelineStatus: 'unknown',
    unresolvedThreads: 0,
  };
}

// ── StackManager ─────────────────────────────────────────────────────────────

/**
 * Pure, synchronous tree operations on a single Stack.
 *
 * All methods return a **new** Stack (immutable updates) — the caller is
 * responsible for persisting the result.
 */
export const StackManager = {
  // ── Creation ─────────────────────────────────────────────────────────────

  /** Create a new empty stack. Generates a UUID for the id; `name` becomes `stackName`. */
  createStack(name: string, root: string): Stack {
    return { id: crypto.randomUUID(), stackName: name, root, nodes: [] };
  },

  // ── Node lookup ──────────────────────────────────────────────────────────

  /** Find a node by branch name, or undefined. */
  findNode(stack: Stack, branch: string): StackNode | undefined {
    return stack.nodes.find((n) => n.branch === branch);
  },

  /** Direct children of a branch (including the root). */
  getChildren(stack: Stack, branch: string): StackNode[] {
    return stack.nodes.filter((n) => n.parent === branch);
  },

  /**
   * All transitive descendants of a branch, in topological order
   * (parent before child). Useful for cascading rebases.
   */
  getDescendants(stack: Stack, branch: string): StackNode[] {
    const result: StackNode[] = [];
    const queue = [branch];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const children = stack.nodes.filter((n) => n.parent === current);
      for (const child of children) {
        result.push(child);
        queue.push(child.branch);
      }
    }

    return result;
  },

  /**
   * Topological sort of all nodes in the stack — parents before children.
   * Uses BFS from the root.
   */
  toposort(stack: Stack): StackNode[] {
    return StackManager.getDescendants(stack, stack.root);
  },

  // ── Mutations (return new Stack) ─────────────────────────────────────────

  /** Add a new node to the stack. */
  addNode(stack: Stack, branch: string, parentBranch: string): Stack {
    // Validate: branch doesn't already exist
    if (StackManager.findNode(stack, branch)) {
      throw new StackError(`Branch "${branch}" already exists in stack "${stack.id}"`);
    }

    // Validate: parent exists (root or another node)
    if (parentBranch !== stack.root && !StackManager.findNode(stack, parentBranch)) {
      throw new StackError(`Parent branch "${parentBranch}" not found in stack "${stack.id}"`);
    }

    return {
      ...stack,
      nodes: [...stack.nodes, createNode(branch, parentBranch)],
    };
  },

  /**
   * Remove a node from the stack.
   * Throws if the node has children — they must be removed or re-parented first.
   */
  removeNode(stack: Stack, branch: string): Stack {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    const children = StackManager.getChildren(stack, branch);
    if (children.length > 0) {
      throw new StackError(
        `Cannot remove "${branch}" — it has ${children.length} child branch(es). Remove or re-parent them first.`,
      );
    }

    return {
      ...stack,
      nodes: stack.nodes.filter((n) => n.branch !== branch),
    };
  },

  /** Move a node to a new parent. */
  moveNode(stack: Stack, branch: string, newParent: string): Stack {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    // Validate: new parent exists
    if (newParent !== stack.root && !StackManager.findNode(stack, newParent)) {
      throw new StackError(`New parent "${newParent}" not found in stack "${stack.id}"`);
    }

    // Validate: not creating a cycle (newParent is not a descendant of branch)
    const descendants = StackManager.getDescendants(stack, branch);
    if (descendants.some((d) => d.branch === newParent)) {
      throw new StackError(`Cannot move "${branch}" under "${newParent}" — would create a cycle`);
    }

    return {
      ...stack,
      nodes: stack.nodes.map((n) => (n.branch === branch ? { ...n, parent: newParent } : n)),
    };
  },

  /** Update a node's sync status. */
  updateNodeStatus(stack: Stack, branch: string, status: StackNodeStatus): Stack {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    return {
      ...stack,
      nodes: stack.nodes.map((n) => (n.branch === branch ? { ...n, status } : n)),
    };
  },

  /** Update a node with a partial patch (e.g. after forge sync). */
  updateNode(stack: Stack, branch: string, patch: Partial<StackNode>): Stack {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    return {
      ...stack,
      nodes: stack.nodes.map((n) => (n.branch === branch ? { ...n, ...patch } : n)),
    };
  },

  /** Rename a branch in the stack tree, updating children's parent references. */
  renameBranch(stack: Stack, oldBranch: string, newBranch: string): Stack {
    const node = StackManager.findNode(stack, oldBranch);
    if (!node) {
      throw new StackError(`Branch "${oldBranch}" not found in stack "${stack.id}"`);
    }
    if (StackManager.findNode(stack, newBranch)) {
      throw new StackError(`Branch "${newBranch}" already exists in stack "${stack.id}"`);
    }

    return {
      ...stack,
      nodes: stack.nodes.map((n) => {
        if (n.branch === oldBranch) return { ...n, branch: newBranch };
        if (n.parent === oldBranch) return { ...n, parent: newBranch };
        return n;
      }),
    };
  },

  /** Toggle the `unmanaged` flag on a node (skips cascade rebase when true). */
  toggleUnmanaged(stack: Stack, branch: string): Stack {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    return {
      ...stack,
      nodes: stack.nodes.map((n) =>
        n.branch === branch ? { ...n, unmanaged: !n.unmanaged } : n,
      ),
    };
  },

  // ── Validation ───────────────────────────────────────────────────────────

  /** Validate that the stack tree is well-formed. Returns an array of issues (empty = valid). */
  validate(stack: Stack): string[] {
    const issues: string[] = [];
    const branchNames = new Set(stack.nodes.map((n) => n.branch));

    for (const node of stack.nodes) {
      // Every parent must exist (as root or as another node)
      if (node.parent !== stack.root && !branchNames.has(node.parent)) {
        issues.push(`Node "${node.branch}" references missing parent "${node.parent}"`);
      }

      // No self-loops
      if (node.branch === node.parent) {
        issues.push(`Node "${node.branch}" is its own parent`);
      }
    }

    // Check for duplicate branch names
    if (branchNames.size !== stack.nodes.length) {
      issues.push('Stack contains duplicate branch names');
    }

    return issues;
  },
};
