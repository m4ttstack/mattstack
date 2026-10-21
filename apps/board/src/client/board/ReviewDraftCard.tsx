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
} from 'react';

import { Markdown, Modal } from '@mattstack/tui-kit';
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
      <div className="tui-diff-modal-body">
        <DiffBoundary
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
        onClick={openable ? () => setOpen(true) : undefined}
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
          <p className="tui-review-code-held" data-tone="error" role="alert">
            {error}
          </p>
        )}
        {snippet && DiffView && (
          <DiffBoundary>
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
        <>
          <div className="tui-review-comment-field">
            <DraftField
              label={label}
              draft={finding.comment!}
              value={form.texts[key]}
              mode={mode}
              onChange={t => form.setText(key, t)}
            />
          </div>
          <div className="tui-review-comment-foot">
            <span>Markdown supported</span>
            <FieldTabs label={label} mode={mode} onMode={setMode} />
          </div>
        </>
      ) : (
        <p className="tui-review-section-note">
          Posts in the summary (no diff line)
        </p>
      )}
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
            />
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

/** A finding with no diff line, as a part of the summary it posts in. */
function FoldedPart({
  finding: f,
  form,
  mode,
  onWrite,
  onRemove,
}: {
  finding: FindingEntry;
  form: GateFormState;
  mode: FieldMode;
  onWrite: () => void;
  onRemove: () => void;
}) {
  const key = commentKey(f.id);
  const label = `Summary comment: ${f.title}`;
  const { edited } = commentState(f.comment!, form.texts[key], true);
  return (
    <div
      className="tui-review-summary-part"
      data-part="folded"
      data-draft-part=""
      data-edited={edited || undefined}
    >
      <div className="tui-review-summary-part-head">
        <span className="tui-review-summary-part-title">+ {f.title}</span>
        <DraftMeta
          edited={edited}
          label={label}
          resetText="reset"
          onReset={() => {
            form.clearText(key);
            onWrite();
          }}
        />
        <button
          type="button"
          className="tui-composer-act"
          aria-label={`${label}: remove`}
          onClick={onRemove}
        >
          × remove
        </button>
      </div>
      <DraftField
        label={label}
        draft={f.comment!}
        value={form.texts[key]}
        mode={mode}
        onChange={t => form.setText(key, t)}
      />
    </div>
  );
}

/** The review's summary note as it will post (`joinSummary`): the summary
    line for the picked verdict, then each ticked finding with no diff
    line as its own removable part. */
export function RailSummary({
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
    <section
      className="tui-review-summary"
      aria-label="Summary comment"
      data-draft-part=""
    >
      <div className="tui-review-summary-head">
        <span className="tui-review-summary-k">
          summary comment · {verdictLabel}
        </span>
        <DraftMeta
          edited={edited}
          label="Summary line"
          resetText="reset"
          onReset={() => {
            form.clearText(key);
            setMode('write');
          }}
        />
        <FieldTabs label="Summary comment" mode={mode} onMode={setMode} />
      </div>
      <div className="tui-review-summary-body">
        <div
          className="tui-review-summary-part"
          data-part="summary-line"
          data-edited={edited || undefined}
        >
          <DraftField
            key={key}
            label="Summary line"
            draft={draft}
            value={form.texts[key]}
            mode={mode}
            onChange={t => form.setText(key, t)}
          />
        </div>
        {folded.map(f => (
          <FoldedPart
            key={f.id}
            finding={f}
            form={form}
            mode={mode}
            onWrite={() => setMode('write')}
            onRemove={() => onRemove(f)}
          />
        ))}
      </div>
    </section>
  );
}
