import { quote } from './items'

// What a run types into its pane. A reused tab's shell can be in any folder, so the script goes to the one Confirm showed, or does
// not run. The builtin, quietly: a cd function or a chpwd hook in .zshenv could lead elsewhere.
export function wrapped(token: string, script: string, cwd: string): string {
  const wrapper = `trap : INT; printf "__todo_pid_${token} %s\\n" $$; builtin cd -qP -- "$2" && zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?`
  return `zsh -c ${quote(wrapper)} todo ${quote(script)} ${quote(cwd)}`
}

export const killGroup = (pgid: number): string[] => ['/bin/sh', '-c', `kill -KILL -- -${pgid}`]
