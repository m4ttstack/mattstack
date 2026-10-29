import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  gateAnswerPayload,
  optionDisplayFor,
  optionValue,
  type GateAnswers,
  type GateSelections,
} from '@mattstack/gate-kit';
import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { Button, Chip } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { approvalSlots } from '../../view.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  parseGateCtx,
  type PlanCtx,
  type PostCtx,
  type ThreadCtx,
} from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import { THREAD_CALL } from './GateParts.tsx';
import { MrCard } from './MrCard.tsx';
import { forgeNoun, mrRef } from './MrLinks.tsx';
import { usePeople } from './people.ts';
import { PersonLead, PersonTag } from './PersonLead.tsx';
import { PlanThreadCard } from './PlanThreadCard.tsx';
import {
  joinPlan,
  planThreadOrder,
  replyOnlyThreads,
  type JoinedThread,
  type StepReply,
} from './respond-join.ts';
import {
  planReplies,
  planTexts,
  postPicks,
  postTally,
  postTexts,
  type PostPick,
} from './respond-post.ts';
import {
  PostResolveChoice,
  ReplyBlock,
  ReplyChoiceBody,
  SeverityPill,
  ThreadCard,
  ThreadOutcome,
} from './RespondCards.tsx';
import {
  gateRounds,
  itemMix,
  itemNoun,
  leadVerb,
  RespondCtxFacts,
  respondPerson,
  subjectRef,
} from './RespondGateHeader.tsx';
import { useSheetKeys } from './sheet-keys.ts';
import { sheetAnswers } from './sheet-payload.ts';
import {
  Choices,
  KeyCap,
  Note,
  PhaseTrack,
  ProseContext,
  reserveDock,
  RoundHeading,
  SheetEnd,
  SheetLost,
  SheetRows,
  SUBMIT_KEYS,
  type RowChip,
  type SheetRow,
} from './SheetParts.tsx';
import { ThreadReplyCard } from './ThreadReplyCard.tsx';

/** A post-step thread's decision: post its final reply or hold it. Both
    write the replies checklist the gate answers with. */
function PostChoice({
  q,
  entry,
  form,
}: {
  q: GateItemDisplay;
  entry: JoinedThread;
  form: GateFormState;
}) {
  const current = form.selections[q.name];
  const posting = new Set(Array.isArray(current) ? current : []).has(
    entry.threadId
  );
  const choices = [
    { post: true, label: 'post', subtitle: 'post this reply to the thread' },
    { post: false, label: 'hold', subtitle: 'keep it back; nothing is posted' },
  ];
  return (
    <div
      className="tui-gate-choices"
      role="radiogroup"
      aria-label={`${entry.label}: post or hold`}
    >
      {choices.map(c => {
        const checked = posting === c.post;
        return (
          <label
            className="tui-gate-choice"
            data-checked={checked || undefined}
            key={c.label}
          >
            <input
              type="radio"
              className="tui-gate-choice-input"
              data-type="radio"
              data-checked={checked ? '' : undefined}
              name={`${q.name}:${entry.threadId}`}
              value={c.label}
              checked={checked}
              onChange={() => form.toggleMulti(q.name, entry.threadId, c.post)}
            />
            <span className="tui-gate-choice-label">
              <span className="tui-gate-choice-label-row">{c.label}</span>
              <span className="tui-gate-choice-subtitle">{c.subtitle}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** A post-step thread drawn with its plan-step card; `children` are the
    controls for what this gate does with its reply. `reply`, when given,
    draws the reply in place of the card's read-only one. A reply-only
    thread takes no controls: Gate 1 decided it, and it posts with this
    step. */
function PostStepCard({
  j,
  reply,
  children,
}: {
  j: JoinedThread;
  reply?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="tui-gate-question"
      data-gate-ctx="thread"
      data-step="post"
      aria-label={j.label}
    >
      <div className="tui-gate-question-head">
        <span className="tui-gate-question-label">{j.label}</span>
        <SeverityPill severity={j.thread.severity} />
        {j.replyOnly ? (
          <ThreadOutcome verb="reply" withStep />
        ) : (
          (j.reply ?? j.decided) && (
            <ThreadOutcome verb={j.reply?.verb ?? j.decided!} held={!j.reply} />
          )
        )}
      </div>
      <ThreadCard
        replyEdited={Boolean(j.replyOnly?.edited)}
        ctx={{
          ...j.thread,
          reply:
            j.reply && !reply
              ? { kind: 'verbatim', text: j.reply.text }
              : j.replyOnly
                ? { kind: 'verbatim', text: j.replyOnly.text }
                : { kind: 'none' },
        }}
      >
        {reply}
      </ThreadCard>
      {j.reply
        ? children
        : !j.replyOnly && (
            <p className="tui-thread-nothing">
              Nothing to post for this thread.
            </p>
          )}
    </section>
  );
}

/** A Gate 1 reply-only thread on a post sheet that could not be joined to
    its plan card by card: the joined card when the plan card still parses
    and the text is known, else a plain card with the text or a line saying
    Gate 1 approved it. No controls either way. */
function StepReplyCard({ s }: { s: StepReply }) {
  if (s.thread && s.text !== undefined)
    return (
      <PostStepCard
        j={{
          threadId: s.threadId,
          label: s.label,
          thread: s.thread,
          decided: 'reply',
          replyOnly: { text: s.text, edited: s.edited },
        }}
      >
        {null}
      </PostStepCard>
    );
  return (
    <section
      className="tui-gate-question"
      data-gate-ctx="thread"
      data-step="post"
      aria-label={s.label}
    >
      <div className="tui-gate-question-head">
        <span className="tui-gate-question-label">{s.label}</span>
        <ThreadOutcome verb="reply" withStep />
      </div>
      <div className="tui-thread-card">
        {s.text !== undefined ? (
          <ReplyBlock text={s.text} edited={s.edited} />
        ) : (
          <p className="tui-thread-nothing">
            Approved at Gate 1; posts with this step.
          </p>
        )}
      </div>
    </section>
  );
}

const VERB_ORDER = ['fix', 'reply', 'skip'] as const;

const VERB_PLURAL = { fix: 'fixes', reply: 'replies', skip: 'skips' } as const;

const VERB_INTENT = {
  fix: 'accent',
  reply: 'ok',
  skip: 'muted',
} as const;

/** A respond-plan answer that sends the plan back: every thread keeps its
    pick (the recommended option where none was made; the domain skill
    ignores thread picks on a revise, but the gate requires every one), and
    code-changes carries `revise` with the operator's reason as its note. */
function reviseAnswers(
  gate: GateRow,
  selections: GateSelections,
  notes: Record<string, string>,
  reason: string
): { answers: GateAnswers } | null {
  const sel: GateSelections = {};
  for (const q of gate.questions) {
    if (q.id === CODE_CHANGES_QUESTION_ID) continue;
    const v = selections[q.id];
    if (q.multi) sel[q.id] = Array.isArray(v) ? v : [];
    else if (typeof v === 'string' && v) sel[q.id] = v;
    else {
      const fallback =
        q.options.find(o => optionDisplayFor(o).recommended) ?? q.options[0];
      if (fallback) sel[q.id] = optionValue(fallback);
    }
  }
  sel[CODE_CHANGES_QUESTION_ID] = 'revise';
  const payload = gateAnswerPayload(gate.questions, sel);
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = (
      id === CODE_CHANGES_QUESTION_ID ? reason : (notes[id] ?? '')
    ).trim();
    answers[id] = note ? { value, note } : value;
  }
  return { answers };
}

/** A thread in plan order for the dock rows: one this gate offers, or one
    that posts with this step on Gate 1's word. */
type RowThread = { threadId: string; label: string; postsWithStep: boolean };

/** One line per thread (or reply) with what the submit will do with it,
    filled in as picks are made; it sits in the dock above the submit. Given
    `plan`, rows follow that plan order and a reply-only thread gets its own
    `post` row, since it posts with this step. */
function ResponseRows({
  mainQs,
  picks,
  form,
  plan,
}: {
  mainQs: GateItemDisplay[];
  picks: PostPick[];
  form: GateFormState;
  plan?: RowThread[] | null;
}) {
  // A resolve chip's slot is kept on every row once any row can resolve, so
  // every row's text starts at one edge.
  const resolveSlot = picks.some(p => p.resolve);
  const offered: SheetRow[] = mainQs.flatMap(q => {
    const v = form.selections[q.name];
    const pick = picks.find(p => p.name === q.name);
    if (pick) {
      const picked = new Set(Array.isArray(v) ? v : []);
      const chips: RowChip[] = [
        picked.has(pick.post)
          ? { text: 'post', intent: 'ok' }
          : { text: 'hold', intent: 'muted' },
        ...(resolveSlot
          ? [
              pick.resolve && picked.has(pick.resolve)
                ? ({ text: 'resolve', intent: 'accent' } as const)
                : null,
            ]
          : []),
      ];
      return [{ key: q.name, text: pick.label, chips }];
    }
    if (q.multiple) {
      const picked = new Set(Array.isArray(v) ? v : []);
      return q.choices.map(c => ({
        key: `${q.name}:${c.value}`,
        text: c.label,
        chips: [
          picked.has(c.value)
            ? { text: 'post', intent: 'ok' as const }
            : { text: 'hold', intent: 'muted' as const },
        ],
      }));
    }
    const verb =
      typeof v === 'string'
        ? VERB_ORDER.find(verb => v.startsWith(`${verb}:`))
        : undefined;
    return [
      {
        key: q.name,
        text: q.prompt,
        chips: [
          {
            text: verb ?? '…',
            intent: verb ? VERB_INTENT[verb] : ('muted' as const),
          },
        ],
      },
    ];
  });
  const checklist = mainQs.find(
    q => q.multiple && !picks.some(p => p.name === q.name)
  );
  const rows = plan
    ? plan.flatMap((j): SheetRow[] => {
        const pick = picks.find(p => p.threadId === j.threadId);
        const key = pick
          ? pick.name
          : checklist && `${checklist.name}:${j.threadId}`;
        const row = key ? offered.find(r => r.key === key) : undefined;
        if (row) return [row];
        if (!j.postsWithStep) return [];
        const post: RowChip = { text: 'post', intent: 'ok' };
        return [
          {
            key: `with-step:${j.threadId}`,
            text: j.label,
            chips: resolveSlot ? [post, null] : [post],
          },
        ];
      })
    : offered;
  return <SheetRows card="responses" rows={rows} />;
}

/** The MR's merge blockers as the board row reads them, so the rail and the
    row's status pill never disagree. */
function MrStatusCard({ mr }: { mr: BoardMRWithReview }) {
  const b = mr.blockers;
  const { filled, required } = approvalSlots(mr);
  const ci =
    mr.pipelineState === 'passed'
      ? { chip: 'pass', intent: 'ok' as const, text: 'pipeline passing' }
      : mr.pipelineState === 'failed'
        ? { chip: 'fail', intent: 'bad' as const, text: 'pipeline failing' }
        : mr.pipelineState === 'running'
          ? { chip: 'run', intent: 'warn' as const, text: 'pipeline running' }
          : { chip: 'n/a', intent: 'muted' as const, text: 'no pipeline' };
  const rows = [
    { key: 'ci', ...ci },
    {
      key: 'approvals',
      chip: mr.reviews.isApproved ? 'ok' : 'wait',
      intent: mr.reviews.isApproved ? ('ok' as const) : ('warn' as const),
      text: `${filled} of ${required} approvals`,
    },
    b.hasConflicts
      ? {
          key: 'conflicts',
          chip: 'fail',
          intent: 'bad' as const,
          text: 'merge conflicts with target branch',
        }
      : {
          key: 'conflicts',
          chip: 'ok',
          intent: 'ok' as const,
          text: 'no merge conflicts',
        },
    ...(mr.behindTarget
      ? [
          {
            key: 'behind',
            chip: 'info',
            intent: 'muted' as const,
            text: `${mr.behindTarget} commits behind ${mr.targetBranch}`,
          },
        ]
      : []),
  ];
  return (
    <div className="tui-sheet-card" data-card="mr-status">
      <span className="tui-sheet-card-title">mr status</span>
      <div className="tui-sheet-card-list">
        {rows.map(r => (
          <div className="tui-sheet-card-row" key={r.key}>
            <Chip
              intent={r.intent}
              variant="outline"
              uppercase
              className="tui-sheet-card-chip"
            >
              {r.chip}
            </Chip>
            <span className="tui-sheet-card-text">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A respond gate in the full-screen sheet: the respond header and every
    thread (or reply) in the main column, each decided on its own card; the
    rail shows what the submit will do, the MR's status, and docks the
    submit. On a respond-plan gate the code-changes question never shows:
    any fix pick implies `approve`, none implies the gate's sentinel, and
    `revise` is its own action with a required reason. */
function RespondSheetBody({
  gate,
  mr,
  ctx,
  form,
  onContinue,
  frame,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  ctx: PlanCtx | PostCtx;
  form: GateFormState;
  /** Retires a gate answered elsewhere from the queue. */
  onContinue: () => void;
  /** The gate's own context as prose, when the emitter flattened it to fit
      the budget: `ctx` then carries no reviewer, and this is shown instead. */
  frame?: string;
}) {
  const people = usePeople(mr);
  // The send-back reason is code-changes' note on the wire, so it lives in
  // the form's notes and rides the gate's draft like any other note.
  const reason = form.notes[CODE_CHANGES_QUESTION_ID] ?? '';
  const setReason = (text: string) =>
    form.setNote(CODE_CHANGES_QUESTION_ID, text);
  const [revising, setRevising] = useState(() => reason.trim() !== '');
  // Board-only: the ticks ride beside the answer, never inside it, so the
  // gate's own answer stays what the pane expects.
  const [reReviewIds, setReReviewIds] = useState<Set<string>>(() => new Set());
  const questionCtx = useMemo(
    () => new Map(gate.questions.map(q => [q.id, parseGateCtx(q.context)])),
    [gate.questions]
  );
  // A thread keeps its place in the list even when its structured
  // context was dropped to prose; the gate contract keeps thread-* ids
  // positional. A multi is a post step's replies checklist or one of its
  // per-thread questions, structured or not.
  const perItem = (q: GateItemDisplay) => {
    const shape = questionCtx.get(q.name)?.shape;
    return (
      shape === 'thread@1' ||
      shape === 'replies@1' ||
      /^thread-/.test(q.name) ||
      q.multiple
    );
  };
  const plan = ctx.shape === 'plan@1';
  const picks = useMemo(
    () => (ctx.shape === 'post@1' ? postPicks(gate.questions) : []),
    [ctx.shape, gate.questions]
  );
  const perThread = picks.length > 0;
  const planReplyList = useMemo(
    () => (plan ? planReplies(gate.questions) : []),
    [plan, gate.questions]
  );
  const codeChanges = gate.questions.find(
    q => q.id === CODE_CHANGES_QUESTION_ID
  );
  const ccValues = new Set((codeChanges?.options ?? []).map(optionValue));
  // Without the sentinel there is nothing to fall back to when no thread is
  // a fix, so the question stays in the dock for the user to answer.
  const impliedCodeChanges =
    plan &&
    ccValues.has('approve') &&
    ccValues.has('revise') &&
    ccValues.has(CODE_CHANGES_SENTINEL);
  const mainQs = form.display.filter(perItem);
  const dockQs = form.display.filter(
    q =>
      !perItem(q) &&
      !(impliedCodeChanges && q.name === CODE_CHANGES_QUESTION_ID)
  );
  const fixes = mainQs.filter(q => {
    const v = form.selections[q.name];
    return typeof v === 'string' && v.startsWith('fix:');
  }).length;
  const submitSelections: GateSelections = { ...form.selections };
  if (impliedCodeChanges) {
    if (fixes > 0) submitSelections[CODE_CHANGES_QUESTION_ID] = 'approve';
    else delete submitSelections[CODE_CHANGES_QUESTION_ID];
  }
  const shown = new Set(form.display.map(q => q.name));
  // A revise answered in the dock re-plans: no reply posts, so no edit rides
  // and an emptied one cannot block it.
  const dockRevise = submitSelections[CODE_CHANGES_QUESTION_ID] === 'revise';
  const edits = dockRevise
    ? {}
    : plan
      ? planTexts(planReplyList, form.selections, form.texts)
      : postTexts(picks, form.selections, form.texts);
  const payload = revising
    ? reason.trim()
      ? reviseAnswers(gate, form.selections, form.notes, reason)
      : null
    : edits === null
      ? null
      : sheetAnswers(gate, shown, submitSelections, form.notes, edits);

  const replyPicks = mainQs.filter(q => {
    const v = form.selections[q.name];
    return !q.multiple && typeof v === 'string' && v.startsWith('reply:');
  });
  // A reply the developer has not read word for word (no verbatim draft), or
  // whose note may change it, is redrafted and approved at gate 2 like a fix;
  // an edited reply posts its text as written.
  const sentTexts = edits ?? {};
  const overrides = replyPicks.filter(
    q =>
      sentTexts[q.name] === undefined &&
      (!planReplyList.some(r => r.name === q.name) ||
        (form.notes[q.name] ?? '').trim() !== '')
  ).length;
  const replyCount = replyPicks.length - overrides;
  const threadsDecided = mainQs.filter(
    q => !q.multiple && typeof form.selections[q.name] === 'string'
  ).length;
  const allDecided = threadsDecided === mainQs.filter(q => !q.multiple).length;
  const tally = VERB_ORDER.map(verb => {
    const n = mainQs.filter(q => {
      const v = form.selections[q.name];
      return typeof v === 'string' && v.startsWith(`${verb}:`);
    }).length;
    return n > 0 ? `${n} ${n === 1 ? verb : VERB_PLURAL[verb]}` : null;
  }).filter(Boolean);
  const repliesQ = perThread ? undefined : mainQs.find(q => q.multiple);
  const repliesPicked = repliesQ
    ? ((form.selections[repliesQ.name] as string[] | undefined)?.length ?? 0)
    : 0;
  const repliesCtx = repliesQ ? questionCtx.get(repliesQ.name) : undefined;
  // The post step draws each reply with its plan-step card when the plan
  // gate it follows is still on the MR row; otherwise the plain checklist.
  const joined =
    ctx.shape === 'post@1' && repliesCtx?.shape === 'replies@1'
      ? joinPlan(
          ctx,
          repliesCtx.replies,
          repliesQ!.choices.map(c => c.value),
          mr
        )
      : null;
  const postable = joined?.filter(j => j.reply).map(j => j.threadId) ?? [];
  const repliesName = repliesQ?.name;
  const seedPostable = () => {
    if (!repliesName || !joined) return;
    for (const id of postable) form.toggleMulti(repliesName, id, true);
  };
  // Seeds before the first paint, so an untouched gate never flashes as held.
  useLayoutEffect(() => {
    if (!repliesName || form.selections[repliesName] !== undefined) return;
    seedPostable();
    // Seeds once per gate, and only a checklist no draft or pick has touched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.gateId, joined !== null]);
  const pickReplies = picks.flatMap(p => (p.reply ? [p.reply] : []));
  // Per-thread questions join the plan the same way, once every one still
  // carries its structured reply.
  const threadJoin =
    ctx.shape === 'post@1' && perThread && pickReplies.length === picks.length
      ? joinPlan(
          ctx,
          pickReplies,
          picks.map(p => p.threadId),
          mr
        )
      : null;
  const seedPicks = (force: boolean) => {
    for (const p of picks)
      if (force || form.selections[p.name] === undefined)
        for (const v of p.defaults) form.toggleMulti(p.name, v, true);
  };
  useLayoutEffect(() => {
    seedPicks(false);
    // Seeds once per gate; a thread with a draft or a pick keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.gateId, picks.length]);
  const { posting, resolving } = postTally(picks, form.selections);
  // A held thread keeps its edit in the form but shows the draft, so the card
  // shows only what will post.
  const postingPick = (p: PostPick) => {
    const v = form.selections[p.name];
    return Array.isArray(v) && v.includes(p.post);
  };
  // A reply card: the header's tick posts, the reviewer's comment reads
  // above the reply when the plan gate's thread is known.
  const replyCard = (p: PostPick, thread?: ThreadCtx) => {
    const live = postingPick(p);
    const reply = p.reply!;
    return (
      <ThreadReplyCard
        key={p.name}
        label={p.label}
        status={
          reply.verb === 'fix'
            ? { text: 'Fixed', hue: 'green' }
            : { text: 'Reply only', hue: 'muted' }
        }
        sha={reply.sha}
        tag={thread && <SeverityPill severity={thread.severity} />}
        layout="stacked"
        mr={
          mr
            ? {
                url: mr.webUrl ?? undefined,
                ref: mrRef(mr),
                revision: mr.updatedAt ?? undefined,
              }
            : undefined
        }
        check={(() => {
          // A reply-only thread's call was settled on the plan gate.
          const verdict =
            reply.verb === 'fix' &&
            thread &&
            THREAD_CALL[thread.verdict.call].check;
          return verdict && thread.verdict.note
            ? { note: thread.verdict.note, verdict }
            : undefined;
        })()}
        messages={
          thread?.claim.summary
            ? [{ who: people.short(thread.author), text: thread.claim.summary }]
            : []
        }
        draft={reply.text}
        value={live ? form.texts[p.name] : undefined}
        posting={live}
        onPosting={on => form.toggleMulti(p.name, p.post, on)}
        resolve={
          p.resolve
            ? {
                on: (() => {
                  const v = form.selections[p.name];
                  return Array.isArray(v) && v.includes(p.resolve!);
                })(),
                onChange: on => form.toggleMulti(p.name, p.resolve!, on),
              }
            : undefined
        }
        onChange={text => form.setText(p.name, text)}
        onReset={() => form.clearText(p.name)}
      />
    );
  };
  const pickNames = new Set(picks.map(p => p.name));
  const displayOf = (name: string) => form.display.find(q => q.name === name);
  const postThreads = joined ?? threadJoin;
  const stepThreads =
    !postThreads && ctx.shape === 'post@1' && perThread
      ? replyOnlyThreads(
          ctx,
          picks.map(p => p.threadId),
          mr
        )
      : [];
  const withStep = postThreads
    ? postThreads.filter(j => j.replyOnly).length
    : stepThreads.length;
  const planRank = new Map(
    (stepThreads.length > 0 && ctx.shape === 'post@1'
      ? planThreadOrder(ctx, mr)
      : []
    ).map((id, i) => [id, i])
  );
  const rank = (id: string) => planRank.get(id) ?? planRank.size;
  // Offered and reply-only threads interleave in plan question order; with
  // no reply-only thread every rank ties and the offered order stands.
  const proseItems: Array<
    { threadId: string; label: string } & (
      { pick: PostPick } | { step: StepReply }
    )
  > = [
    ...picks.map(pick => ({
      threadId: pick.threadId,
      label: pick.label,
      pick,
    })),
    ...stepThreads.map(step => ({
      threadId: step.threadId,
      label: step.label,
      step,
    })),
  ].sort((a, b) => rank(a.threadId) - rank(b.threadId));
  const rowThreads: RowThread[] | null = postThreads
    ? postThreads.map(j => ({
        threadId: j.threadId,
        label: j.label,
        postsWithStep: !!j.replyOnly,
      }))
    : stepThreads.length > 0
      ? proseItems.map(item => ({
          threadId: item.threadId,
          label: item.label,
          postsWithStep: 'step' in item,
        }))
      : null;
  const listCount = postThreads?.length ?? picks.length + stepThreads.length;
  const mix = itemMix(
    postThreads
      ? postThreads.map(j => j.label)
      : perThread
        ? proseItems.map(item => item.label)
        : mainQs.map(q => q.prompt)
  );
  const person = respondPerson(ctx, gate.openedAt, mr);
  const personTag = <PersonTag id={person} name={people.short(person)} />;
  const dockPick = dockQs
    .map(q => {
      const v = form.selections[q.name];
      return q.choices.find(c => c.value === v)?.label;
    })
    .find(Boolean);
  const replyNoun = (n: number) => (n === 1 ? '1 reply' : `${n} replies`);
  const nextStep =
    !plan || !allDecided || dockRevise || edits === null
      ? null
      : fixes > 0
        ? `Next, ${fixes} ${fixes === 1 ? 'fix gets' : 'fixes get'} implemented, then you approve ${replyNoun(fixes + overrides)} before anything posts.`
        : overrides > 0
          ? `Next, you approve ${replyNoun(overrides)} before anything posts.`
          : replyCount > 0
            ? `Next, ${replyCount} ${replyCount === 1 ? 'reply posts' : 'replies post'}.`
            : 'Next, nothing posts.';
  // The rail's reply count is the submit's own on every post sheet, so the
  // two never disagree.
  const railPosting = perThread
    ? posting + withStep
    : repliesQ
      ? repliesPicked + withStep
      : undefined;
  const submitLabel = form.busy
    ? 'submitting…'
    : revising
      ? 'send back for revision'
      : plan
        ? ['submit', ...tally].join(' · ')
        : perThread
          ? [
              [
                posting + withStep > 0 ? `post ${posting + withStep}` : null,
                resolving > 0 ? `resolve ${resolving}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'hold all',
              dockPick,
            ]
              .filter(Boolean)
              .join(' · ')
          : [`post ${repliesPicked + withStep}`, dockPick]
              .filter(Boolean)
              .join(' · ');
  const runPerson = mr?.respond?.person?.toLowerCase();
  const latches = plan
    ? []
    : (mr?.reviewerLatches ?? []).filter(
        l =>
          !l.requested && (!runPerson || l.reviewer.toLowerCase() === runPerson)
      );
  const reReview = latches
    .filter(l => reReviewIds.has(l.discussionId))
    .map(l => l.discussionId);
  const submitPayload = payload && { ...payload, reReview };
  const toggleReReview = (id: string, on: boolean) =>
    setReReviewIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const canSubmit = !form.lost && !form.busy && payload !== null;
  useSheetKeys({
    onSubmit: canSubmit ? () => void form.submit(submitPayload) : undefined,
  });

  return (
    <div className="tui-sheet-body">
      <section className="tui-sheet-main" data-sheet="respond">
        <RoundHeading
          {...gateRounds(ctx, mr?.respond?.responseRound)}
          aside={<PhaseTrack at={plan ? 'Plan' : 'Post'} />}
        />
        <div className="tui-sheet-list-head">
          <span className="tui-sheet-list-title">
            {postThreads || perThread ? (
              <>
                Post replies on {listCount} {itemNoun(listCount, mix)}
                {frame === undefined && <> from {personTag}</>}
              </>
            ) : repliesQ ? (
              repliesQ.prompt
            ) : (
              <>
                Respond to {mainQs.length} {itemNoun(mainQs.length, mix)} from{' '}
                {personTag}
              </>
            )}
          </span>
          <span className="tui-sheet-list-tally">
            {perThread
              ? `${posting + withStep} of ${picks.length + withStep} posting`
              : joined
                ? `${repliesPicked + withStep} of ${postable.length + withStep} posting`
                : repliesQ
                  ? `${repliesPicked} of ${repliesQ.choices.length} selected`
                  : `${threadsDecided} of ${mainQs.length} decided`}
          </span>
        </div>
        {!postThreads && !perThread && !repliesQ && (
          <p className="tui-sheet-list-lede">
            Choose how to answer each comment: fix the code or just reply.
            Untick one to skip it.
          </p>
        )}
        <div className="tui-respond-list">
          {threadJoin
            ? threadJoin.map(j => {
                const pick = picks.find(p => p.threadId === j.threadId);
                if (pick?.reply) return replyCard(pick, j.thread);
                return (
                  <PostStepCard key={j.threadId} j={j}>
                    {pick && !pick.reply && (
                      <PostResolveChoice pick={pick} form={form} />
                    )}
                  </PostStepCard>
                );
              })
            : proseItems.map(item => {
                if ('step' in item)
                  return (
                    <StepReplyCard
                      key={`with-step:${item.threadId}`}
                      s={item.step}
                    />
                  );
                const p = item.pick;
                const display = displayOf(p.name);
                if (p.reply) return replyCard(p);
                return (
                  <section
                    key={p.name}
                    className="tui-gate-question"
                    data-gate-ctx="thread"
                    data-step="post"
                    aria-label={p.label}
                  >
                    <div className="tui-gate-question-head">
                      <span className="tui-gate-question-label">{p.label}</span>
                    </div>
                    {display?.context && questionCtx.get(p.name) == null ? (
                      <ProseContext q={display} structured={false} />
                    ) : (
                      <p className="tui-thread-nothing">
                        The reply text did not fit the gate; read it in the
                        pane.
                      </p>
                    )}
                    <PostResolveChoice pick={p} form={form} />
                  </section>
                );
              })}
          {mainQs
            .filter(q => !pickNames.has(q.name))
            .map(q => {
              const qctx = questionCtx.get(q.name);
              const pr = planReplyList.find(r => r.name === q.name);
              if (!q.multiple && qctx?.shape === 'thread@1')
                return (
                  <PlanThreadCard
                    key={q.name}
                    q={q}
                    ctx={qctx}
                    form={form}
                    reviewer={people.short(qctx.author)}
                    draft={pr?.draft}
                    mr={
                      mr
                        ? {
                            url: mr.webUrl ?? undefined,
                            ref: mrRef(mr),
                            revision: mr.updatedAt ?? undefined,
                          }
                        : undefined
                    }
                  />
                );
              if (!q.multiple)
                return (
                  <section
                    key={q.name}
                    className="tui-gate-question"
                    aria-label={q.prompt}
                  >
                    <div className="tui-gate-question-head">
                      <span className="tui-gate-question-label">
                        {q.prompt}
                      </span>
                    </div>
                    <ProseContext q={q} structured={qctx != null} />
                    <Choices q={q} form={form} />
                    <Note q={q} form={form} />
                  </section>
                );
              if (joined)
                return (
                  <Fragment key={q.name}>
                    {joined.map(j => (
                      <PostStepCard key={j.threadId} j={j}>
                        <PostChoice q={q} entry={j} form={form} />
                      </PostStepCard>
                    ))}
                    <Note q={q} form={form} />
                  </Fragment>
                );
              const replies = qctx?.shape === 'replies@1' ? qctx.replies : [];
              return (
                <section
                  key={q.name}
                  className="tui-respond-replies"
                  data-gate-ctx="replies"
                  aria-label={q.prompt}
                >
                  <Choices
                    q={q}
                    form={form}
                    renderLabel={(value, chip) => {
                      const entry = replies.find(r => r.thread === value);
                      return entry ? (
                        <ReplyChoiceBody entry={entry}>{chip}</ReplyChoiceBody>
                      ) : (
                        value
                      );
                    }}
                  />
                  <Note q={q} form={form} />
                </section>
              );
            })}
        </div>
        <SheetEnd>You've reached the end of the threads.</SheetEnd>
      </section>
      <aside className="tui-sheet-rail">
        {form.lost ? (
          <SheetLost gate={gate} lost={form.lost} onContinue={onContinue} />
        ) : (
          <>
            <div className="tui-sheet-rail-scroll">
              {mr && <MrCard mr={mr} />}
              <div className="tui-sheet-context-card">
                <span className="tui-sheet-context-label">
                  decision context
                </span>
                {frame === undefined ? (
                  <PersonLead id={person} name={people.short(person)}>
                    {leadVerb(mix)} your {forgeNoun(mr, gate.subject)}
                  </PersonLead>
                ) : (
                  frame && <p className="tui-sheet-context-meta">{frame}</p>
                )}
                <RespondCtxFacts
                  ctx={ctx}
                  mix={mix}
                  posting={railPosting}
                  responseRound={mr?.respond?.responseRound}
                />
              </div>
              {mr && <MrStatusCard mr={mr} />}
            </div>
            <div className="tui-sheet-dock" ref={reserveDock}>
              <div className="tui-sheet-dock-head">
                <h3 className="tui-sheet-dock-heading">
                  {revising ? 'Send back' : plan ? 'Responses' : 'Replies'}
                  {` on ${mr ? mrRef(mr) : subjectRef(gate.subject)}`}
                </h3>
                <button
                  type="button"
                  className="tui-sheet-reset"
                  onClick={() => {
                    if (revising) {
                      setRevising(false);
                      setReason('');
                    } else {
                      // Each card resets its own reply to the draft; this
                      // resets the picks, and never discards typed words.
                      form.resetAll({ keepTexts: true });
                      seedPostable();
                      seedPicks(true);
                      setReReviewIds(new Set());
                    }
                  }}
                >
                  {revising ? 'cancel' : 'reset'}
                </button>
              </div>
              {revising ? (
                <textarea
                  className="tui-gate-note tui-sheet-revise-reason"
                  aria-label="What should the new plan change?"
                  placeholder="What should the new plan change?"
                  value={reason}
                  onChange={e => setReason(e.currentTarget.value)}
                />
              ) : (
                <>
                  <ResponseRows
                    mainQs={mainQs}
                    picks={picks}
                    form={form}
                    plan={rowThreads}
                  />
                  {nextStep && (
                    <p className="tui-sheet-dock-next">{nextStep}</p>
                  )}
                  {latches.length > 0 && (
                    <div
                      className="tui-sheet-card-list tui-respond-rereview"
                      data-section="re-review"
                      data-resolve-slot={
                        picks.some(p => p.resolve) || undefined
                      }
                      role="group"
                      aria-label="Re-review"
                    >
                      {latches.map(l => {
                        const on = reReviewIds.has(l.discussionId);
                        return (
                          <label
                            key={l.discussionId}
                            className="tui-sheet-card-row tui-respond-rereview-row"
                          >
                            <span className="tui-respond-rereview-lead">
                              <Chip intent="accent" variant="outline" uppercase>
                                re-review
                              </Chip>
                            </span>
                            <span className="tui-sheet-card-text">
                              ask {people.short(l.reviewer)} after posting
                            </span>
                            <span className="tui-check">
                              <input
                                type="checkbox"
                                className="tui-gate-choice-input"
                                data-type="checkbox"
                                data-checked={on ? '' : undefined}
                                checked={on}
                                onChange={e =>
                                  toggleReReview(
                                    l.discussionId,
                                    e.currentTarget.checked
                                  )
                                }
                              />
                              <span
                                className="tui-check-tick"
                                aria-hidden="true"
                              />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {!revising &&
                dockQs.map(q => (
                  <div key={q.name} className="tui-sheet-dock-question">
                    <span className="tui-sheet-dock-prompt">{q.prompt}</span>
                    <ProseContext
                      q={q}
                      structured={questionCtx.get(q.name) != null}
                    />
                    <Choices q={q} form={form} />
                    <Note q={q} form={form} />
                  </div>
                ))}
              <Button
                type="button"
                variant="filled"
                intent="accent"
                size="lg"
                className="tui-sheet-submit"
                disabled={!canSubmit}
                onClick={() => void form.submit(submitPayload)}
              >
                {submitLabel}
                {!form.busy && <KeyCap keys={SUBMIT_KEYS} onFill />}
              </Button>
              {impliedCodeChanges && !revising && (
                <button
                  type="button"
                  className="tui-sheet-revise"
                  onClick={() => setRevising(true)}
                >
                  send the plan back for revision
                </button>
              )}
              {!revising && edits === null && (
                <span className="tui-gate-error">
                  {plan
                    ? 'a reply is empty: write it or skip the thread'
                    : 'a reply is empty: write it or hold the thread'}
                </span>
              )}
              {form.failed && (
                <span className="tui-gate-error">
                  submit failed... nothing was sent, try again
                </span>
              )}
              {form.focusError && (
                <span className="tui-gate-error">{form.focusError}</span>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export { RespondSheetBody };
