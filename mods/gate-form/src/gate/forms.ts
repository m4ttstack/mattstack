import type { Form, LegacyForm } from '../../types'

// The pane shows the first open form, in open order; with none open, the last one, so its ending stays readable.
export function currentForm(list: Form[]): Form | undefined {
  return list.find(f => f.status === 'open') ?? list.at(-1)
}

export const openCount = (list: Form[]) => list.filter(f => f.status === 'open').length

// What the band and herdr's blocker say while a form waits; null with none open.
export function waitingTitle(list: Form[]): string | null {
  const form = currentForm(list)
  if (form?.status !== 'open') return null
  const more = openCount(list) - 1
  return more > 0 ? `${form.title}, ${more} more waiting` : form.title
}

// One form per gate: a form for a gate already listed, or for the gate it supersedes, takes that form's place,
// as an ask form takes the place of the last ask form. Closed forms go.
export function addForm(list: Form[], form: Form, supersededId?: string | null): Form[] {
  const replaces = (f: Form) =>
    f.gateId === undefined ? form.gateId === undefined && f.source === form.source : f.gateId === form.gateId || f.gateId === supersededId
  const at = list.findIndex(replaces)
  const kept = list.filter((f, i) => i === at || (!replaces(f) && f.status === 'open'))
  return at < 0 ? [...kept, form] : kept.map(f => (replaces(f) ? form : f))
}

export function patchForm(list: Form[], formId: string, patch: Partial<Form>): Form[] {
  return list.map(f => (f.id === formId ? { ...f, ...patch } : f))
}

export function markGate(list: Form[], gateId: string, patch: Partial<Form>): Form[] {
  return list.map(f => (f.gateId === gateId ? { ...f, ...patch } : f))
}

// A Client's props must stay under 100,000 characters, so a gate too large to draw whole gives up
// what it can lose, in order: option descriptions, question contexts, then its own context.
export function fitForm(form: Form, budget: number): Form {
  const fits = (f: Form) => JSON.stringify(f).length <= budget
  if (fits(form)) return form
  const plain = { ...form, questions: form.questions.map(q => ({ ...q, options: q.options.map(({ description: _, ...o }) => o) })) }
  if (fits(plain)) return plain
  const bare = { ...plain, questions: plain.questions.map(({ context: _, ...q }) => q) }
  if (fits(bare)) return bare
  const { context: _, ...rest } = bare
  return rest
}

// A value the form-3 atom stored: one form, every option list ending in "Something else". A form whose reply went
// to a toast was a demo, which no agent waits on, so it is dropped.
export function fromLegacy(old: LegacyForm | null): Form[] {
  if (!old || old.replyTo !== 'agent') return []
  const { replyTo: _, ...rest } = old
  return [{ ...rest, source: 'ask', questions: old.questions.map(q => ({ ...q, other: true })) }]
}

// Forms stored by a build that still had the demo source.
export const knownForms = (list: Form[]): Form[] => list.filter(f => f.source === 'gate' || f.source === 'ask' || f.source === 'plugin')
