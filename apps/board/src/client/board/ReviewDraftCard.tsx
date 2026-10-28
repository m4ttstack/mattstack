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
import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';

import { Modal, Popover } from '@mattstack/tui-kit';
import { ClickToEditField } from './ClickToEditField.tsx';
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
import type { FindingEntry } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import {
  AgentGlyph,
  ArrowOutGlyph,
  ChevronGlyph,
  FileGlyph,
  InfoGlyph,
  UndoGlyph,
} from './icons.tsx';
import { commentKey, hasDiffLine, summaryKey } from './review-drafts.ts';

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
          <span className="tui-review-code-path">
            {path}
            {line !== undefined && (
              <span className="tui-review-code-line">:{line}</span>
            )}
          </span>
          {finding.body && <FindingInfo body={finding.body} />}
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
function FindingInfo({ body }: { body: string }) {
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
        <button
          type="button"
          className="tui-review-info"
          aria-label="Agent finding"
        >
          <InfoGlyph />
        </button>
      }
    >
      <div className="tui-review-info-card">
        <span className="tui-review-info-title">Agent finding</span>
        <CommentMarkdown>{body}</CommentMarkdown>
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
          <span className="tui-review-code-path">{f.file}</span>
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
}: {
  finding: FindingEntry;
  form: GateFormState;
}) {
  const key = commentKey(finding.id);
  const label = `Comment on ${finding.title}`;
  const { edited } = commentState(finding.comment!, form.texts[key], true);
  return (
    <section
      className="tui-review-section"
      data-section="comment"
      data-draft-part=""
      data-edited={edited || undefined}
      aria-label="Comment"
    >
      <CommentEditor
        label={label}
        draft={finding.comment!}
        value={form.texts[key]}
        variant="plain"
        heading="Editing comment"
        actions={
          edited && (
            <DraftMeta
              edited
              label={label}
              onReset={() => form.clearText(key)}
            />
          )
        }
        badge={
          edited && (
            <>
              <span className="tui-cte-badge-state">Edited</span>
              <span className="tui-cte-badge-sep" aria-hidden="true" />
              <DraftMeta
                edited
                label={label}
                resetText="Reset"
                onReset={() => form.clearText(key)}
              />
            </>
          )
        }
        onChange={t => form.setText(key, t)}
      />
    </section>
  );
}

/** One finding in a review whose comments the board posts: the header
    with its tick, then The Code, the agent's finding and the comment that
    posts. Unticked, only the header shows. */
export function FindingCard({
  finding: f,
  checked,
  head,
  form,
  mrUrl,
  mrRef,
  mrRevision,
  pins,
}: {
  finding: FindingEntry;
  checked: boolean;
  head: ReactNode;
  form: GateFormState;
  mrUrl?: string;
  mrRef?: string;
  mrRevision?: string;
  pins: FilePin[];
}) {
  return (
    <article
      className="tui-review-finding tui-review-card"
      data-off={checked ? undefined : ''}
    >
      {head}
      <LazyMotion features={domAnimation}>
        <AnimatePresence initial={false}>
          {checked && (
            <m.div
              key="body"
              className="tui-review-card-body"
              // Clips only while easing: open, the body must let the
              // finding's info card, which renders in place, spill out.
              initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
              animate={{
                height: 'auto',
                opacity: 1,
                transitionEnd: { overflow: 'visible' },
              }}
              exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            >
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
              <CommentSection finding={f} form={form} />
            </m.div>
          )}
        </AnimatePresence>
      </LazyMotion>
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
        variant="filled"
        onChange={t => form.setText(key, t)}
      />
    </section>
  );
}
