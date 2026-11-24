const BODY_MAX = 140

// The herdr call herdr-doorbell.sh makes for AskUserQuestion, which a kit form replaces: named after the working
// directory, since the tab label is often just an index, with the first question as the body.
export function bellArgs(cwd: string, questions: { label: string }[], sound: 'request' | 'none'): string[] {
  const who = cwd.replace(/\/+$/, '').split('/').at(-1) || 'claude'
  let body = (questions[0]?.label ?? '').split(/\s+/).filter(Boolean).join(' ') || 'needs an answer'
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 3)}...`
  if (questions.length > 1) body += `  (+${questions.length - 1} more)`
  return ['notification', 'show', `${who} needs you`, '--body', body, '--sound', sound]
}
