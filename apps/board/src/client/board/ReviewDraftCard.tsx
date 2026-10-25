import {
  Component,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Chip, Markdown, Modal } from '@mattstack/tui-kit';
import type { ReportFinding } from '../../review-finding.ts';
import {
  CommentField,
  commentState,
  FieldTabs,
  resetToWrite,
  type FieldMode,
} from './CommentComposer.tsx';
import {
  anchorLine,
  anchorPath,
  diffStats,
  filePatch,
  useDiffView,
  useFileDiff,
  windowPatch,
  type FileDiff,
} from './diff-source.ts';
import type { DiffPin } from './DiffView.tsx';
import type { FindingEntry } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import {
  AgentGlyph,
  ArrowOutGlyph,
  CodeGlyph,
  CommentGlyph,
  FileGlyph,
  QuestionGlyph,
  RemoveGlyph,
} from './icons.tsx';
import { commentKey, hasDiffLine, summaryKey } from './review-drafts.ts';
import { SEVERITY_LABEL } from './review-gate.ts';

/** A diff that fails to load or render leaves the file header standing. */
class DiffBoundary extends Component<
  { fallback?: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed
      ? (this.props.fallback ?? null)
      : this.props.children;
  }
}

const FORGE_NAME = { gitlab: 'GitLab', github: 'GitHub' } as const;

/** A finding on a file, for pinning in that file's full diff. */
export interface FilePin {
  id: string;
  title: string;
  line: number;
}

function SectionHead({
  icon,
  name,
  hue,
  children,
}: {
  icon: ReactNode;
  name: string;
  hue: 'muted' | 'accent' | 'ok';
  children?: ReactNode;
}) {
  return (
    <div className="tui-review-section-head">
      <span className="tui-review-section-name" data-hue={hue}>
        {icon}
        {name}
      </span>
      {children}
    </div>
  );
}

/** How long the full diff keeps re-centring the finding you came from
    while the renderer, its highlighting and the pins lay out. */
const REVEAL_SETTLE_MS = 2000;

/** Centres the finding you came from in the full diff's scroll body. The
    diff draws in stages (renderer chunk, highlighting, then the pins), each
    moving the pin, so it re-centres on every layout change until it
    settles, and stops for good once you scroll yourself. */
function useRevealCurrentPin(body: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let done = false;
    const reveal = () => {
      if (done) return;
      const pin = el.querySelector<HTMLElement>('.tui-diff-pin[data-current]');
      if (!pin) return;
      const box = el.getBoundingClientRect();
      const at = pin.getBoundingClientRect();
      el.scrollTop += at.top - box.top - (el.clientHeight - at.height) / 2;
    };
    const watched = new Set<Element>();
    const resizes = new ResizeObserver(reveal);
    const mutations = new MutationObserver(() => {
      for (const child of el.querySelectorAll('.tui-diff, .tui-diff-pin'))
        if (!watched.has(child)) {
          watched.add(child);
          resizes.observe(child);
        }
      reveal();
    });
    mutations.observe(el, { childList: true, subtree: true });
    const stop = () => {
      done = true;
      mutations.disconnect();
      resizes.disconnect();
    };
    const userScrolls = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    for (const type of userScrolls)
      el.addEventListener(type, stop, { once: true, passive: true });
    const settle = setTimeout(stop, REVEAL_SETTLE_MS);
    reveal();
    return () => {
      clearTimeout(settle);
      for (const type of userScrolls) el.removeEventListener(type, stop);
      stop();
    };
  }, [body]);
}

/** The whole file's diff over the sheet: hunk headers, every finding on
    the file pinned at its line, the one opened from marked. Escape closes
    it and focus goes back to `returnTo`. */
function FullDiffModal({
  view: DiffView,
  diff,
  mrRef,
  pins,
  current,
  returnTo,
  onClose,
}: {
  view: NonNullable<ReturnType<typeof useDiffView>>;
  diff: FileDiff;
  mrRef?: string;
  pins: FilePin[];
  current: string;
  returnTo: HTMLElement | null;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    root.current?.focus();
    return () => returnTo?.focus({ preventScroll: true });
  }, [returnTo]);
  const stats = useMemo(() => diffStats(diff), [diff]);
  const patch = useMemo(() => filePatch(diff), [diff]);
  const byId = useMemo(() => new Map(pins.map(p => [p.id, p])), [pins]);
  const diffPins = useMemo<DiffPin[]>(
    () => pins.map(p => ({ id: p.id, line: p.line })),
    [pins]
  );
  const anchor = byId.get(current)?.line;
  const forge = FORGE_NAME[diff.forge];
  const body = useRef<HTMLDivElement | null>(null);
  useRevealCurrentPin(body);
  // The sheet behind has its own Tab trap and Escape: this keeps Tab in
  // the modal, and Escape closes only the modal, never the sheet too.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const el = root.current;
    if (!el) return;
    const focusable = [
      ...el.querySelectorAll<HTMLElement>('button, [href], [tabindex="0"]'),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const atStart =
      document.activeElement === first || document.activeElement === el;
    if (e.shiftKey && atStart) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const findings = `${pins.length} ${pins.length === 1 ? 'finding' : 'findings'} on this file`;
  return (
    <Modal
      ref={root}
      tabIndex={-1}
      className="tui-diff-modal"
      overlayClassName="tui-diff-overlay"
      ariaLabel={`Full diff of ${diff.path}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      title={
        <span className="tui-diff-modal-head">
          <span className="tui-diff-modal-lead">
            <span className="tui-diff-modal-path">
              <FileGlyph />
              {diff.path}
            </span>
            <span className="tui-diff-modal-sub">
              {[
                mrRef,
                `+${stats.additions} −${stats.deletions}`,
                findings,
                `fetched from ${forge}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {diff.webUrl && (
            <a
              className="tui-review-section-link"
              href={diff.webUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              open on {forge}
              <ArrowOutGlyph />
            </a>
          )}
        </span>
      }
    >
      <div className="tui-diff-modal-body" ref={body}>
        <DiffBoundary
          key={diff.patch}
          fallback={
            <p className="tui-diff-note">The diff could not be drawn.</p>
          }
        >
          <Suspense
            fallback={<p className="tui-diff-note">Loading the diff…</p>}
          >
            <DiffView
              patch={patch}
              anchor={anchor}
              pins={diffPins}
              renderPin={pin => {
                const p = byId.get(pin.id);
                return (
                  p && (
                    <div
                      className="tui-diff-pin"
                      data-current={p.id === current || undefined}
                    >
                      <AgentGlyph />
                      <span className="tui-diff-pin-title">{p.title}</span>
                      {p.id === current && (
                        <span className="tui-diff-pin-here">
                          · you came from here
                        </span>
                      )}
                    </div>
                  )
                );
              }}
            />
          </Suspense>
        </DiffBoundary>
      </div>
    </Modal>
  );
}

/** The MR's changes page on its forge, read off its web URL. */
function changesLink(
  mrUrl: string | undefined
): { href: string; forge: string } | null {
  if (!mrUrl) return null;
  const base = mrUrl.replace(/\/+$/, '');
  if (/\/-\/merge_requests\/\d+$/.test(base))
    return { href: `${base}/diffs`, forge: FORGE_NAME.gitlab };
  if (/\/pull\/\d+$/.test(base))
    return { href: `${base}/files`, forge: FORGE_NAME.github };
  return null;
}

/** A finding's code: the file's header, then, once the forge's diff is
    in, the diff lines around the anchor. Until then, or when there is no
    diff, the header stands alone. The snippet and "view full diff" open
    the whole file's diff. A diff the forge holds back, or one that failed
    to load, says so under the header and links to it on the forge. */
function CodeSection({
  mrUrl,
  mrRef,
  mrRevision,
  finding,
  pins,
}: {
  mrUrl?: string;
  mrRef?: string;
  mrRevision?: string;
  finding: FindingEntry;
  pins: FilePin[];
}) {
  const file = finding.file!;
  const path = anchorPath(file);
  const line = anchorLine(file);
  const state = useFileDiff(mrUrl, path, mrRevision);
  const DiffView = useDiffView();
  const fetchedDiff = state.status === 'ready' ? state.diff : null;
  const heldBack =
    fetchedDiff !== null &&
    (fetchedDiff.tooLarge === true ||
      fetchedDiff.binary === true ||
      fetchedDiff.patch.trim() === '');
  const diff = fetchedDiff && !heldBack && DiffView ? fetchedDiff : null;
  const error = state.status === 'error' && DiffView ? state.message : null;
  const openable = diff !== null;
  const forgeLink =
    heldBack && fetchedDiff.webUrl
      ? { href: fetchedDiff.webUrl, forge: FORGE_NAME[fetchedDiff.forge] }
      : error !== null
        ? changesLink(mrUrl)
        : null;
  const snippet = useMemo(
    () => (diff && line !== undefined ? windowPatch(diff, line) : null),
    [diff, line]
  );
  const [open, setOpen] = useState(false);
  const link = useRef<HTMLButtonElement | null>(null);
  return (
    <section
      className="tui-review-section"
      data-section="code"
      aria-label="The Code"
    >
      <SectionHead icon={<CodeGlyph />} name="The Code" hue="muted">
        {forgeLink && (
          <a
            className="tui-review-section-link"
            href={forgeLink.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            open on {forgeLink.forge}
            <ArrowOutGlyph />
          </a>
        )}
        {openable && (
          <button
            ref={link}
            type="button"
            className="tui-review-section-link"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            view full diff
            <ArrowOutGlyph />
          </button>
        )}
      </SectionHead>
      <div
        className="tui-review-code"
        data-openable={openable ? '' : undefined}
        onClick={
          openable
            ? e => {
                const picked = window.getSelection();
                if (
                  picked &&
                  !picked.isCollapsed &&
                  e.currentTarget.contains(picked.anchorNode)
                )
                  return;
                setOpen(true);
              }
            : undefined
        }
      >
        <div className="tui-review-code-file">
          <FileGlyph />
          <span className="tui-review-code-path">
            {path}
            {line !== undefined && (
              <span className="tui-review-code-line">:{line}</span>
            )}
          </span>
          {openable && (
            <span className="tui-review-code-hint" aria-hidden="true">
              click to expand
            </span>
          )}
        </div>
        {heldBack && (fetchedDiff.tooLarge || fetchedDiff.binary) && (
          <p className="tui-review-code-held">
            {fetchedDiff.binary
              ? 'A binary file, with no diff to show here.'
              : 'Too large to show here.'}
          </p>
        )}
        {error !== null && (
          <p className="tui-review-code-held" data-tone="error" role="status">
            {error}
          </p>
        )}
        {snippet && DiffView && (
          <DiffBoundary key={snippet}>
            <Suspense fallback={null}>
              <DiffView patch={snippet} anchor={line} separators="simple" />
            </Suspense>
          </DiffBoundary>
        )}
      </div>
      {open && diff && DiffView && (
        <FullDiffModal
          view={DiffView}
          diff={diff}
          mrRef={mrRef}
          pins={pins}
          current={finding.id}
          returnTo={link.current}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** "edited · reset to draft", or who wrote the text. */
function DraftMeta({
  edited,
  label,
  onReset,
  resetText = 'reset to draft',
  unedited,
}: {
  edited: boolean;
  label: string;
  onReset: () => void;
  resetText?: string;
  unedited?: string;
}) {
  if (!edited)
    return unedited ? (
      <span className="tui-review-section-meta">{unedited}</span>
    ) : null;
  return (
    <span className="tui-review-section-meta" data-edited="">
      <span className="tui-composer-edited">edited</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="tui-composer-act"
        aria-label={`${label}: reset to draft`}
        onClick={e =>
          resetToWrite(e.currentTarget, '[data-draft-part]', onReset)
        }
      >
        {resetText}
      </button>
    </span>
  );
}

/** A comment field with its blank-edit hint, in a part that `DraftMeta`'s
    reset finds by `data-draft-part`. */
function DraftField({
  label,
  draft,
  value,
  mode,
  onChange,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  mode: FieldMode;
  onChange: (text: string) => void;
}) {
  const { text, empty } = commentState(draft, value, true);
  const hint = useId();
  return (
    <>
      <CommentField
        label={label}
        text={text}
        mode={mode}
        invalid={empty}
        describedBy={empty ? hint : undefined}
        onChange={onChange}
      />
      {empty && (
        <span className="tui-gate-error" id={hint}>
          the comment is empty
        </span>
      )}
    </>
  );
}

/** A comment's framed field over its "Markdown supported" footer with the
    Write and Preview tabs: the one editor every review comment uses. */
function CommentEditor({
  label,
  draft,
  value,
  mode,
  onMode,
  onChange,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  mode: FieldMode;
  onMode: (mode: FieldMode) => void;
  onChange: (text: string) => void;
}) {
  return (
    <>
      <div className="tui-review-comment-field">
        <DraftField
          label={label}
          draft={draft}
          value={value}
          mode={mode}
          onChange={onChange}
        />
      </div>
      <div className="tui-review-comment-foot">
        <span>Markdown supported</span>
        <FieldTabs label={label} mode={mode} onMode={onMode} />
      </div>
    </>
  );
}

function CommentSection({
  finding,
  form,
}: {
  finding: FindingEntry;
  form: GateFormState;
}) {
  const key = commentKey(finding.id);
  const label = `Comment on ${finding.title}`;
  const [mode, setMode] = useState<FieldMode>('write');
  const { edited } = commentState(finding.comment!, form.texts[key], true);
  const anchored = hasDiffLine(finding);
  return (
    <section
      className="tui-review-section"
      data-section="comment"
      data-draft-part=""
      data-edited={(anchored && edited) || undefined}
      aria-label="Comment"
    >
      <SectionHead icon={<CommentGlyph />} name="Comment" hue="ok">
        {anchored && (
          <DraftMeta
            edited={edited}
            label={label}
            unedited="drafted by the agent"
            onReset={() => {
              form.clearText(key);
              setMode('write');
            }}
          />
        )}
      </SectionHead>
      {anchored ? (
        <CommentEditor
          label={label}
          draft={finding.comment!}
          value={form.texts[key]}
          mode={mode}
          onMode={setMode}
          onChange={t => form.setText(key, t)}
        />
      ) : (
        <p className="tui-review-section-note">
          Posts in the summary (no diff line)
        </p>
      )}
    </section>
  );
}

/** A report json finding (what the questions agent revises) as the sheet's
    finding entry: the tier lowercased to a severity, and `file` plus `line`
    joined as the gate's `file:line` anchor. */
export function findingEntryFromReport(f: ReportFinding): FindingEntry {
  const file =
    f.file === undefined
      ? undefined
      : f.line === undefined || f.line === ''
        ? f.file
        : `${f.file}:${f.line}`;
  return {
    id: f.id,
    severity: f.tier.toLowerCase() as FindingEntry['severity'],
    title: f.title,
    body: f.body,
    comment: f.comment,
    ...(file !== undefined ? { file } : {}),
    ...(f.fix !== undefined ? { fix: f.fix } : {}),
    ...(f.evidence !== undefined ? { evidence: f.evidence } : {}),
    ...(f.kind !== undefined ? { kind: f.kind } : {}),
  };
}

/** A `file:line` anchor split into its path and the line part after the
    last colon (a single line or a range such as `117–119`). */
function splitAnchor(file: string | undefined): {
  path: string;
  lines?: string;
} {
  if (file === undefined) return { path: '' };
  const m = /^(.*):(\d[^:]*)$/.exec(file);
  return m ? { path: m[1]!, lines: m[2]! } : { path: file };
}

/** What a revision changed, in the strip's order: the severity, the anchor
    (`lines a → b` on the same file, the whole anchor when the file moved),
    then whether the title or body was reworded. */
export function revisionSummary(
  original: FindingEntry,
  revised: FindingEntry
): string[] {
  const parts: string[] = [];
  if (original.severity !== revised.severity)
    parts.push(
      `${SEVERITY_LABEL[original.severity]} → ${SEVERITY_LABEL[revised.severity]}`
    );
  if (original.file !== revised.file) {
    const a = splitAnchor(original.file);
    const b = splitAnchor(revised.file);
    parts.push(
      a.path === b.path && a.lines !== undefined && b.lines !== undefined
        ? `lines ${a.lines} → ${b.lines}`
        : `${original.file ?? 'no file'} → ${revised.file ?? 'no file'}`
    );
  }
  if (original.title !== revised.title || original.body !== revised.body)
    parts.push('finding reworded');
  return parts;
}

/** A finding the review agent rewrote from a question: what changed and in
    which question tab, with the original finding's text behind a toggle. */
function RevisedStrip({
  original,
  revised,
  tabLabel,
}: {
  original: FindingEntry;
  revised: FindingEntry;
  tabLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const text = [
    `Revised from your question in ${tabLabel}`,
    ...revisionSummary(original, revised),
  ].join(' · ');
  return (
    <div className="tui-review-revised">
      <div className="tui-review-revised-head">
        <span className="tui-review-revised-text">{text}</span>
        <button
          type="button"
          className="tui-review-section-link"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'hide original' : 'show original'}
        </button>
      </div>
      {open && (
        <div className="tui-review-revised-original">
          <Markdown unstyled linkTargetBlank>
            {original.body}
          </Markdown>
        </div>
      )}
    </div>
  );
}

/** What the Agent Finding head's question control shows: `idle` offers
    to ask, `opening` is a launch still coming up (no tab to focus yet),
    `live` is the open question. `failed` is why the last launch did not
    open, shown beside the control until a new ask clears it. */
export interface FindingAsk {
  state: 'idle' | 'opening' | 'live';
  failed?: string;
  onAsk: () => void;
}

/** The Agent Finding head's question control: "ask a question" opens a
    questions pane for the finding; while the launch comes up it reads as
    "opening a question…" and takes no click; once one is running it reads
    as the open question and brings that pane forward. A failed launch puts
    a quiet error line beside it. */
function AskControl({
  title,
  id,
  ask,
}: {
  title: string;
  id: string;
  ask: FindingAsk;
}) {
  const control =
    ask.state === 'live' ? (
      <button
        type="button"
        className="tui-review-section-link"
        data-live=""
        aria-label={`${title}: question open, Q ${id}`}
        onClick={ask.onAsk}
      >
        question open · Q {id}
        <ArrowOutGlyph />
      </button>
    ) : ask.state === 'opening' ? (
      <button
        type="button"
        className="tui-review-section-link"
        aria-label={`${title}: opening a question`}
        disabled
      >
        opening a question…
      </button>
    ) : (
      <button
        type="button"
        className="tui-review-section-link"
        aria-label={`${title}: ask a question`}
        onClick={ask.onAsk}
      >
        ask a question
        <QuestionGlyph />
      </button>
    );
  if (!ask.failed) return control;
  return (
    <span className="tui-review-section-meta">
      <span className="tui-review-ask-failed" role="status">
        couldn&apos;t open the question: {ask.failed}
      </span>
      {control}
    </span>
  );
}

/** One finding in a review whose comments the board posts: the header
    with its tick, then The Code, the agent's finding and the comment that
    posts. Unticked, only the header shows. A finding revised from a
    question carries the revised strip under its header, ticked or not, so
    the change is in view while deciding whether to post it. */
export function FindingCard({
  finding: f,
  checked,
  head,
  form,
  mrUrl,
  mrRef,
  mrRevision,
  pins,
  ask,
  revision,
}: {
  finding: FindingEntry;
  checked: boolean;
  head: ReactNode;
  form: GateFormState;
  mrUrl?: string;
  mrRef?: string;
  mrRevision?: string;
  pins: FilePin[];
  ask?: FindingAsk;
  revision?: {
    original: FindingEntry;
    revised: FindingEntry | null;
    tabLabel: string;
  };
}) {
  return (
    <article
      className="tui-review-finding tui-review-card"
      data-off={checked ? undefined : ''}
      data-revised={revision?.revised ? '' : undefined}
    >
      {head}
      {revision?.revised && (
        <RevisedStrip
          original={revision.original}
          revised={revision.revised}
          tabLabel={revision.tabLabel}
        />
      )}
      {checked && (
        <>
          {f.file && (
            <CodeSection
              mrUrl={mrUrl}
              mrRef={mrRef}
              mrRevision={mrRevision}
              finding={f}
              pins={pins}
            />
          )}
          <section
            className="tui-review-section"
            data-section="finding"
            aria-label="Agent Finding"
          >
            <SectionHead
              icon={<AgentGlyph />}
              name="Agent Finding"
              hue="accent"
            >
              {ask && <AskControl title={f.title} id={f.id} ask={ask} />}
            </SectionHead>
            <div className="tui-review-section-body">
              <Markdown unstyled linkTargetBlank>
                {f.body}
              </Markdown>
            </div>
          </section>
          <CommentSection finding={f} form={form} />
        </>
      )}
    </article>
  );
}

/** A finding with no diff line, as a section of the summary it posts in,
    with its own editor and a control to drop it from the summary. */
function FoldedSection({
  finding: f,
  form,
  onRemove,
}: {
  finding: FindingEntry;
  form: GateFormState;
  onRemove: () => void;
}) {
  const key = commentKey(f.id);
  const label = `Summary comment: ${f.title}`;
  const [mode, setMode] = useState<FieldMode>('write');
  const { edited } = commentState(f.comment!, form.texts[key], true);
  return (
    <section
      className="tui-review-section"
      data-section="folded"
      data-draft-part=""
      data-edited={edited || undefined}
      aria-label={f.title}
    >
      <SectionHead icon={<AgentGlyph />} name={f.title} hue="muted">
        <span className="tui-review-section-meta">
          <DraftMeta
            edited={edited}
            label={label}
            unedited="no diff line"
            onReset={() => {
              form.clearText(key);
              setMode('write');
            }}
          />
          <button
            type="button"
            className="tui-review-remove"
            aria-label={`${label}: remove`}
            onClick={onRemove}
          >
            <RemoveGlyph />
            Remove
          </button>
        </span>
      </SectionHead>
      <CommentEditor
        label={label}
        draft={f.comment!}
        value={form.texts[key]}
        mode={mode}
        onMode={setMode}
        onChange={t => form.setText(key, t)}
      />
    </section>
  );
}

/** The summary's verdict badge: approving reads as done, a comment as the
    board's accent, a change request as a warning. */
const VERDICT_INTENT: Record<string, 'ok' | 'accent' | 'warn'> = {
  approve: 'ok',
  comment: 'accent',
  request_changes: 'warn',
};

/** The review's summary comment as it will post (`joinSummary`), as one
    card in the finding cards' frame: the summary line drafted for the
    picked verdict, then each ticked finding with no diff line as its own
    section. */
export function SummaryCard({
  outcome,
  verdictLabel,
  draft,
  folded,
  form,
  onRemove,
}: {
  outcome: string;
  verdictLabel: string;
  draft: string;
  folded: FindingEntry[];
  form: GateFormState;
  onRemove: (f: FindingEntry) => void;
}) {
  const key = summaryKey(outcome);
  const [mode, setMode] = useState<FieldMode>('write');
  const { edited } = commentState(draft, form.texts[key], true);
  return (
    <article className="tui-review-card tui-review-summary">
      <section
        className="tui-review-section"
        data-section="summary"
        data-draft-part=""
        data-edited={edited || undefined}
        aria-label="Summary comment"
      >
        <SectionHead icon={<CommentGlyph />} name="Summary" hue="ok">
          <span className="tui-review-section-meta">
            <DraftMeta
              edited={edited}
              label="Summary line"
              onReset={() => {
                form.clearText(key);
                setMode('write');
              }}
            />
            <Chip
              intent={VERDICT_INTENT[outcome] ?? 'muted'}
              variant="outline"
              uppercase
              data-verdict={outcome}
            >
              for {verdictLabel}
            </Chip>
          </span>
        </SectionHead>
        <CommentEditor
          key={key}
          label="Summary line"
          draft={draft}
          value={form.texts[key]}
          mode={mode}
          onMode={setMode}
          onChange={t => form.setText(key, t)}
        />
      </section>
      {folded.map(f => (
        <FoldedSection
          key={f.id}
          finding={f}
          form={form}
          onRemove={() => onRemove(f)}
        />
      ))}
    </article>
  );
}
