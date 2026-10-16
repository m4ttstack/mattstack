import { createRealProbes } from "../setup/probes.ts";
import { createStackGuardRunners, stackMembershipOf } from "../stack-guard.ts";
import { currentBranch, realGitRunner } from "./git-tools.ts";
import { err, ok, type McpToolDef } from "./shared.ts";
import { checkRegisteredTree, type TreeCheck } from "./tree-guard.ts";

export interface StackToolDeps {
  checkTree: (tree: unknown) => TreeCheck;
  currentBranch: (cwd: string) => Promise<string | null>;
  gitqStacks: (cwd: string) => Promise<string | null>;
}

function realStackToolDeps(): StackToolDeps {
  const runners = createStackGuardRunners(createRealProbes());
  return {
    checkTree: (tree) => checkRegisteredTree(tree),
    currentBranch: (cwd) => currentBranch(cwd, realGitRunner),
    gitqStacks: (cwd) => runners.gitqStacks(cwd),
  };
}

export function stackToolDefs(deps: StackToolDeps = realStackToolDeps()): McpToolDef[] {
  return [
    {
      name: "branch_stack",
      description: "Whether the tree's checked-out branch is a member of a tracked stack. Returns {branch, member, stackStore}; a member also carries stack (its name), parent, root and children. stackStore is \"unavailable\" when the stack store could not be read, in which case member: false is not proof. Reads no forge. tree is the absolute path of a registered checkout or worktree, or a directory inside one, which resolves to that tree's root; the result's tree is the root it read.",
      inputSchema: { type: "object", properties: { tree: { type: "string", description: "Absolute path of a registered checkout or worktree, or a directory inside one." } }, required: ["tree"], additionalProperties: false },
      shellForms: ["gitq stacks"],
      async handler(input) {
        const guard = deps.checkTree(input.tree);
        if (!guard.ok) return err(guard.error);
        const branch = await deps.currentBranch(guard.path);
        if (branch === null) return err("the tree is on a detached HEAD");
        const { known, membership } = await stackMembershipOf(guard.path, branch, { gitqStacks: deps.gitqStacks });
        const tree = guard.path;
        if (!known) return ok({ branch, member: false, stackStore: "unavailable", tree });
        if (!membership) return ok({ branch, member: false, stackStore: "read", tree });
        return ok({ branch, member: true, stack: membership.name, parent: membership.parent, root: membership.root, children: membership.children, stackStore: "read", tree });
      },
    },
  ];
}
