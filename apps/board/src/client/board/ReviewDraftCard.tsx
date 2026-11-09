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
import {
  ChevronDown,
  ChevronUp,
  History,
  MessageCircleQuestionMark,
} from 'lucide-react';
import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';

import { Button, ICONS, Modal, Popover, Tooltip } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import { ClickToEditField } from './ClickToEditField.tsx';
import { CodePath } from './CodePath.tsx';
import { commentState, resetToWrite } from './CommentComposer.tsx';
import { CommentMarkdown } from './CommentMarkdown.tsx';
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
import { Disclosure } from './Disclosure.tsx';
import type { FindingEntry } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import {
  CARD_BODY_MS,
  CardBody,
  CommentArea,
  DraftField,
} from './GateParts.tsx';
import {
  AgentGlyph,
  ArrowOutGlyph,
  CheckGlyph,
  ChevronGlyph,
  FileGlyph,
  UndoGlyph,
} from './icons.tsx';
import { CommentAuthor } from './PersonLead.tsx';
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
export function CodeSection({
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
  const loading = DiffView !== null && state.status === 'loading';
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
  const leavingField = useRef(false);
  const [folded, setFolded] = useState(false);
  const link = useRef<HTMLButtonElement | null>(null);
  return (
    <section
      className="tui-review-section"
      data-section="code"
      aria-label="The Code"
    >
      <div
        className="tui-review-code"
        data-openable={openable ? '' : undefined}
        data-folded={folded || undefined}
      >
        <div className="tui-review-code-file">
          <button
            type="button"
            className="tui-review-code-fold"
            aria-expanded={!folded}
            aria-label={folded ? `Show ${path}` : `Fold ${path}`}
            onClick={() => setFolded(v => !v)}
          >
            <ChevronGlyph />
          </button>
          <FileGlyph />
          <CodePath path={path} line={line} />
          {finding.body && (
            <FindingInfo body={finding.body} fix={finding.fix} />
          )}
          {forgeLink && (
            <a
              className="tui-review-section-link tui-review-code-more"
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
              className="tui-review-section-link tui-review-code-more"
              data-reveal=""
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              full diff
              <ArrowOutGlyph />
            </button>
          )}
        </div>
        <LazyMotion features={domAnimation}>
          <AnimatePresence initial={false}>
            {!folded && (
              <m.div
                key="body"
                className="tui-review-code-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
              >
                {heldBack && (fetchedDiff.tooLarge || fetchedDiff.binary) && (
                  <p className="tui-review-code-held">
                    {fetchedDiff.binary
                      ? 'A binary file, with no diff to show here.'
                      : 'Too large to show here.'}
                  </p>
                )}
                {error !== null && (
                  <p
                    className="tui-review-code-held"
                    data-tone="error"
                    role="status"
                  >
                    {error}
                  </p>
                )}
                {loading && <CodeLoading />}
                {snippet && DiffView && (
                  <div
                    className="tui-review-code-snippet"
                    onMouseDown={() => {
                      // A press that only closes a comment being written must
                      // not also open the full diff.
                      leavingField.current = !!document.activeElement?.closest(
                        '.tui-cte[data-editing]'
                      );
                    }}
                    onClick={e => {
                      if (leavingField.current) return;
                      const picked = window.getSelection();
                      if (
                        picked &&
                        !picked.isCollapsed &&
                        e.currentTarget.contains(picked.anchorNode)
                      )
                        return;
                      setOpen(true);
                    }}
                  >
                    <DiffBoundary key={snippet}>
                      <Suspense fallback={<CodeLoading />}>
                        <DiffView
                          patch={snippet}
                          anchor={line}
                          separators="simple"
                          pending={<CodeLoading />}
                        />
                      </Suspense>
                    </DiffBoundary>
                  </div>
                )}
              </m.div>
            )}
          </AnimatePresence>
        </LazyMotion>
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
export function DraftMeta({
  edited,
  label,
  onReset,
  resetText = 'Reset to draft',
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
      <button
        type="button"
        className="tui-composer-act tui-review-reset"
        aria-label={`${label}: reset to draft`}
        // Keeps a comment being written open: the reset swaps its text in
        // place instead of blurring it shut first.
        onMouseDown={e => e.preventDefault()}
        onClick={e =>
          resetToWrite(e.currentTarget, '[data-draft-part]', onReset)
        }
      >
        <UndoGlyph />
        {resetText}
      </button>
    </span>
  );
}

/** A comment that reads rendered and opens raw on a click, with its
    blank-edit hint, in a part that `DraftMeta`'s reset finds by
    `data-draft-part`. */
export function CommentEditor({
  label,
  draft,
  value,
  variant,
  hint = true,
  onChange,
  onEditing,
  heading,
  actions,
  badge,
  footer,
  lead,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  variant: 'bare' | 'filled' | 'plain';
  hint?: boolean;
  onChange: (text: string) => void;
  onEditing?: (editing: boolean) => void;
  heading?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  lead?: ReactNode;
}) {
  const { text, empty } = commentState(draft, value, true);
  const hintId = useId();
  return (
    <>
      <ClickToEditField
        label={label}
        text={text}
        variant={variant}
        stripe={variant === 'bare' ? 'always' : undefined}
        hint={hint}
        invalid={empty}
        describedBy={empty ? hintId : undefined}
        onChange={onChange}
        onEditing={onEditing}
        heading={heading}
        actions={actions}
        badge={badge}
        footer={footer}
        lead={lead}
      />
      {empty && (
        <span className="tui-gate-error" id={hintId}>
          the comment is empty
        </span>
      )}
    </>
  );
}

/** Holds the snippet's space while its diff or highlighter loads: about
    the seven lines a three-line window shows, so the card neither
    collapses under the file bar nor jumps when the code lands. */
function CodeLoading() {
  return (
    <div className="tui-review-code-loading" aria-hidden="true">
      {[62, 48, 71, 55, 40, 66, 34].map((w, i) => (
        <span key={i} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** The agent's finding behind an info mark in the code's file bar: the
    comment already says it to the author, so it stays a click away. */
function FindingInfo({ body, fix }: { body: string; fix?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={6}
      ariaLabel="Agent finding"
      trigger={
        <Button
          type="button"
          variant="subtle"
          intent="accent"
          size="sm"
          className="tui-review-info"
        >
          Agent finding
          <span
            className="tui-reply-check-chevron"
            data-open={open || undefined}
            aria-hidden
          >
            {ICONS['chevron-right']}
          </span>
        </Button>
      }
    >
      <div className="tui-review-info-card">
        <span className="tui-review-info-title">Agent finding</span>
        <CommentMarkdown>{body}</CommentMarkdown>
        {fix && (
          <div className="tui-review-info-fix">
            <span className="tui-review-info-title">Suggested fix</span>
            <CommentMarkdown>{fix}</CommentMarkdown>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** With no diff line to show, the slot the code takes holds the agent's
    finding instead, under its file when it names one. */
function FindingSection({ finding: f }: { finding: FindingEntry }) {
  return (
    <section
      className="tui-review-section"
      data-section="finding"
      aria-label="Finding"
    >
      {f.file && (
        <div className="tui-review-code-file">
          <FileGlyph />
          <CodePath path={f.file} />
        </div>
      )}
      <div className="tui-review-finding-said">
        <CommentMarkdown>{f.body}</CommentMarkdown>
      </div>
    </section>
  );
}

function CommentSection({
  finding,
  form,
  you,
}: {
  finding: FindingEntry;
  form: GateFormState;
  you?: string;
}) {
  const key = commentKey(finding.id);
  const label = `Comment on ${finding.title}`;
  const { edited } = commentState(finding.comment!, form.texts[key], true);
  return (
    <CommentArea label="Comment" edited={edited}>
      <DraftField
        label={label}
        draft={finding.comment!}
        value={form.texts[key]}
        heading="Editing comment"
        lead={<CommentAuthor id={you} name="You:" />}
        onChange={t => form.setText(key, t)}
        onReset={() => form.clearText(key)}
      />
    </CommentArea>
  );
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

export interface RevisionChange {
  label: string;
  value: string;
  originalTitle?: string;
  original?: string;
}

/** What a revision changed, in the list's order: the severity, the anchor
    (lines on the same file, the whole anchor when the file moved), whether
    the title or body was reworded, then the fix and the drafted comment. */
export function revisionChanges(
  original: FindingEntry,
  revised: FindingEntry
): RevisionChange[] {
  const changes: RevisionChange[] = [];
  if (original.severity !== revised.severity)
    changes.push({
      label: 'Severity',
      value: `${SEVERITY_LABEL[original.severity]} → ${SEVERITY_LABEL[revised.severity]}`,
    });
  if (original.file !== revised.file) {
    const a = splitAnchor(original.file);
    const b = splitAnchor(revised.file);
    changes.push(
      a.path === b.path && a.lines !== undefined && b.lines !== undefined
        ? { label: 'Lines', value: `${a.lines} → ${b.lines}` }
        : {
            label: 'File',
            value: `${original.file ?? 'No file'} → ${revised.file ?? 'No file'}`,
          }
    );
  }
  if (original.title !== revised.title || original.body !== revised.body)
    changes.push({
      label: 'Finding',
      value: 'Reworded',
      originalTitle: original.title,
      original: original.body,
    });
  if (original.fix !== revised.fix)
    changes.push({
      label: 'Fix',
      value:
        original.fix === undefined
          ? 'Added'
          : revised.fix === undefined
            ? 'Removed'
            : 'Changed',
      original: original.fix,
    });
  if (original.comment !== revised.comment)
    changes.push({
      label: 'Comment',
      value: original.comment === undefined ? 'Added' : 'Rewritten',
      original: original.comment,
    });
  return changes;
}

/** A finding the review agent revised in its own pane and re-raised the
    gate with: one quiet line, with what changed behind a toggle and each
    original behind its own. */
function RevisedStrip({
  original,
  revised,
}: {
  original: FindingEntry;
  revised: FindingEntry;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const changes = revisionChanges(original, revised);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="tui-review-revised">
      <div className="tui-review-revised-head">
        <History size={14} aria-hidden />
        <span className="tui-review-revised-text">Revised by the agent</span>
        {changes.length > 0 && (
          <span className="tui-review-revised-count">
            {changes.length} {changes.length === 1 ? 'change' : 'changes'}
          </span>
        )}
        {changes.length > 0 && (
          <Button
            type="button"
            variant="subtle"
            intent="accent"
            size="sm"
            className="tui-review-revised-toggle"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? 'Hide changes' : 'Show changes'}
            <Chevron size={14} aria-hidden />
          </Button>
        )}
      </div>
      <Disclosure open={open}>
        <dl className="tui-review-revised-changes">
          {changes.map(change => (
            <div className="tui-review-revised-change" key={change.label}>
              <dt>{change.label}</dt>
              <dd>{change.value}</dd>
              {change.original !== undefined && (
                <Button
                  type="button"
                  variant="subtle"
                  intent="accent"
                  size="sm"
                  aria-label={`${change.label}: ${shown === change.label ? 'hide' : 'show'} original`}
                  aria-expanded={shown === change.label}
                  onClick={() =>
                    setShown(s => (s === change.label ? null : change.label))
                  }
                >
                  {shown === change.label ? 'Hide original' : 'Show original'}
                  {shown === change.label ? (
                    <ChevronUp size={14} aria-hidden />
                  ) : (
                    <ChevronDown size={14} aria-hidden />
                  )}
                </Button>
              )}
              {change.original !== undefined && (
                <Disclosure open={shown === change.label}>
                  <div className="tui-review-revised-original">
                    {change.originalTitle !== undefined && (
                      <p className="tui-review-revised-title">
                        {change.originalTitle}
                      </p>
                    )}
                    <CommentMarkdown>{change.original}</CommentMarkdown>
                  </div>
                </Disclosure>
              )}
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}

/** One finding's question to the review pane: `idle` offers "ask a
    question", `open` is the area being written, `sending` is the request in
    flight, `asked` is a question the pane took. `blocked` is set while
    another finding's question is sending: one question at a time.
    `unavailable` is why no question can be asked at all (the review pane is
    gone): the link stays, disabled, with the reason as its tooltip. */
export interface FindingAsk {
  state: 'idle' | 'open' | 'sending' | 'asked';
  blocked: boolean;
  unavailable?: string;
  onOpen: () => void;
  onCancel: () => void;
  onSend: (question: string) => void;
  /** Brings the review pane forward; absent when the sheet cannot. */
  onFocusPane?: () => void;
}

export const ASK_PLACEHOLDER = 'What do you want to know about this finding?';

const ASK_TIP = 'Ask the reviewing agent about this finding';

/** A finding's "ask a question" link, at the end of the card head. */
export function AskLink({ title, ask }: { title: string; ask: FindingAsk }) {
  const link = (
    <Button
      type="button"
      iconOnly
      variant="subtle"
      intent="muted"
      size="sm"
      className="tui-review-ask-link"
      aria-label={`${title}: ask a question`}
      aria-expanded={ask.state !== 'idle'}
      disabled={
        ask.unavailable !== undefined || ask.blocked || ask.state === 'sending'
      }
      title={ask.unavailable}
      onClick={ask.onOpen}
    >
      <MessageCircleQuestionMark size={18} aria-hidden />
    </Button>
  );
  return ask.unavailable ? link : <Tooltip tip={ASK_TIP}>{link}</Tooltip>;
}

/** The area under the card head where the question is written and sent to
    the review pane, then where the sheet says the pane took it. */
function AskArea({ title, ask }: { title: string; ask: FindingAsk }) {
  const [text, setText] = useState('');
  const fieldRef = useAutoGrowTextarea([text, ask.state]);
  const areaRef = useRef<HTMLDivElement | null>(null);
  // autoFocus lands while the card body is still at height 0, so the browser
  // cannot scroll to it: the box comes into view once the body has opened.
  useEffect(() => {
    const timer = setTimeout(() => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      areaRef.current?.scrollIntoView?.({
        block: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      });
    }, CARD_BODY_MS);
    return () => clearTimeout(timer);
  }, []);
  // A question the pane took is done with; asking again starts empty.
  useEffect(() => {
    if (ask.state === 'asked') setText('');
  }, [ask.state]);
  if (ask.state === 'asked')
    return (
      <div className="tui-review-ask" data-asked="">
        <span className="tui-review-ask-done" role="status">
          <CheckGlyph />
          Sent a question to the reviewing agent
        </span>
        {ask.onFocusPane && (
          <Button
            type="button"
            variant="subtle"
            intent="accent"
            size="sm"
            onClick={ask.onFocusPane}
          >
            Focus the review pane
            <ArrowOutGlyph />
          </Button>
        )}
      </div>
    );
  const sending = ask.state === 'sending';
  const empty = text.trim() === '';
  return (
    <div className="tui-review-ask" ref={areaRef}>
      <div className="tui-review-ask-field">
        <textarea
          ref={fieldRef}
          className="tui-composer-input"
          rows={3}
          maxLength={2000}
          value={text}
          placeholder={ASK_PLACEHOLDER}
          aria-label={`${title}: your question`}
          disabled={sending}
          autoFocus
          onChange={e => setText(e.currentTarget.value)}
          onKeyDown={e => {
            // Escape and Cmd/Ctrl+Enter here are the question's, never the
            // sheet's: Escape cancels the question rather than closing the
            // sheet, and Cmd/Ctrl+Enter sends it rather than posting the
            // review (sheet-keys.ts submits from any field).
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (!sending) ask.onCancel();
              return;
            }
            if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
            e.stopPropagation();
            e.preventDefault();
            if (!sending && !empty && !ask.blocked) ask.onSend(text);
          }}
        />
      </div>
      <div className="tui-review-ask-actions">
        <Button
          type="button"
          variant="filled"
          intent="accent"
          size="sm"
          disabled={sending || empty || ask.blocked}
          title={ask.blocked ? 'Wait for the other question to send' : undefined}
          onClick={() => ask.onSend(text)}
        >
          Send to the agent
        </Button>
        <Button
          type="button"
          variant="light"
          intent="muted"
          size="sm"
          disabled={sending}
          onClick={ask.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One finding in a review whose comments the board posts: the header
    with its tick, then The Code, the agent's finding and the comment that
    posts. Unticked, only the header shows, carrying the ask link (the
    caller puts it in `head`) with the ask area under it. A finding the review pane
    revised carries the revised strip under its header, ticked or not, so
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
  you,
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
  /** The reviewer's username, for the avatar beside the comment. */
  you?: string;
  ask?: FindingAsk;
  /** The finding as the gate this one superseded carried it. */
  revision?: { original: FindingEntry };
}) {
  return (
    <article
      className="tui-review-finding tui-review-card"
      data-off={checked ? undefined : ''}
      data-revised={revision ? '' : undefined}
    >
      {head}
      {revision && <RevisedStrip original={revision.original} revised={f} />}
      {ask && (
        <CardBody open={ask.state !== 'idle'}>
          <section
            className="tui-review-section"
            data-section="ask"
            aria-label="Question"
          >
            <AskArea title={f.title} ask={ask} />
          </section>
        </CardBody>
      )}
      <CardBody open={checked}>
        {hasDiffLine(f) ? (
          <CodeSection
            mrUrl={mrUrl}
            mrRef={mrRef}
            mrRevision={mrRevision}
            finding={f}
            pins={pins}
          />
        ) : (
          <FindingSection finding={f} />
        )}
        <CommentSection finding={f} form={form} you={you} />
      </CardBody>
    </article>
  );
}

/** The review's summary line, drafted for the picked verdict, in the dock
    beside the choice that swaps it. Two lines at rest; a click opens it
    whole. A finding with no diff line edits in its own card; the poster
    joins it in after this line. */
export function SummaryCard({
  outcome,
  draft,
  form,
  postsOn,
}: {
  outcome: string;
  draft: string;
  form: GateFormState;
  postsOn?: string;
}) {
  const key = summaryKey(outcome);
  const { edited } = commentState(draft, form.texts[key], true);
  return (
    <section
      className="tui-review-dock-summary"
      data-section="summary"
      data-draft-part=""
      data-edited={edited || undefined}
      aria-label="Review comment"
    >
      <div className="tui-review-dock-summary-head">
        <span className="tui-review-dock-summary-title">Review comment</span>
        {edited ? (
          <DraftMeta
            edited
            label="Summary line"
            onReset={() => form.clearText(key)}
          />
        ) : (
          postsOn && (
            <span className="tui-review-section-meta">posts on {postsOn}</span>
          )
        )}
      </div>
      <CommentEditor
        key={key}
        label="Summary line"
        draft={draft}
        value={form.texts[key]}
        variant="plain"
        onChange={t => form.setText(key, t)}
      />
    </section>
  );
}
