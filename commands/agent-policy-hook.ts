/**
 * rt agent policy-hook: the command Codex's installed policy hooks run. It
 * reads Codex's native hook payload on stdin and answers in Codex's hook
 * protocol: stdout, stderr and the exit code are exactly what
 * handleCodexHook returns, written through the output layer's raw seams.
 * Agent-facing and hidden; it takes no positional argument.
 */

import type { CodexPolicyEvent } from "../lib/agent-integrations/codex/hook-manifest.ts";
import { handleCodexHook, type CodexHookDeps, type CodexHookResult } from "../lib/agent-integrations/codex/policy.ts";
import * as out from "../lib/ui/out.ts";

export type PolicyHookIo = {
  readStdin: () => Promise<string>;
  handle: (input: unknown, deps: CodexHookDeps) => Promise<CodexHookResult>;
  exit: (code: number) => void;
};

const defaultIo: PolicyHookIo = {
  readStdin: async () => (process.stdin.isTTY ? "" : await Bun.stdin.text()),
  handle: handleCodexHook,
  exit: (code) => process.exit(code),
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export async function agentPolicyHook(args: string[], io: PolicyHookIo = defaultIo): Promise<void> {
  out.payloadOnStdout();
  // An --event that names no policy event matches no payload, so the hook passes.
  const event = flag(args, "--event") as CodexPolicyEvent | undefined;
  const installation = flag(args, "--installation");
  const stdin = await io.readStdin();
  let input: unknown;
  try {
    input = JSON.parse(stdin);
  } catch {
    input = undefined;
  }
  const result = await io.handle(input, {
    ...(event !== undefined && { event }),
    ...(installation !== undefined && { installation }),
  });
  if (result.stdout) out.payload(result.stdout);
  if (result.stderr) out.diagnostic(result.stderr);
  if (result.exitCode !== 0) io.exit(result.exitCode);
}
