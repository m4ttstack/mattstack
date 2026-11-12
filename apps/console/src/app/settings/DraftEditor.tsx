import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { checkValue, type SchemaIssue } from '@mattstack/settings-kit/shapes';

import { draftNote } from './draftNotes';
import { canDraw, type FormShape } from './formShape';
import {
  footerSummary,
  issueText,
  standingIssues,
  type CardKey,
} from './issues';
import { CardsFooter, ItemCards } from './ItemCards';
import { JsonDraft } from './JsonDraft';
import { ModeToggle, type EditMode } from './ModeToggle';
import { NamedSections } from './NamedSections';
import { PanelToolbar } from './PanelToolbar';
import { cancelOnEscape } from './view';

type Entry = Record<string, unknown>;
type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? '';
}

function parse(text: string): Parsed {
  if (text.trim() === '') return { ok: false, message: 'empty document' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function emptyOf(def: SettingDefWire): unknown {
  return def.type === 'array' ? [] : {};
}

// Centred on the wrapper: Alert's default top alignment plus the icon's
// 1px offset rides a 12px line above a 14px icon.
const NOTE_STYLES = {
  wrapper: { alignItems: 'center' },
  icon: { marginInlineEnd: 6, marginTop: 0 },
} as const;

/** One short line about the draft, beside its icon. */
function DraftNote({
  color,
  icon,
  testId,
  children,
}: {
  color: 'accent' | 'warn';
  icon: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Alert
      variant="tint"
      color={color}
      icon={icon}
      w="fit-content"
      py={4}
      px={10}
      styles={NOTE_STYLES}
      data-testid={testId}
    >
      <Text fz={12}>{children}</Text>
    </Alert>
  );
}

/** A local draft of one layer's value, as JSON or as a form, checked
    against the def's layer schema as it changes and saved only when it
    parses and passes. It opens on JSON unless `startIn` asks for a form
    that can draw the value. Switching modes carries the draft across; the
    form is out of reach while the JSON does not parse or does not fit it.
    Escape and Cancel discard the draft; Escape is marked handled so an
    enclosing modal stays open. */
/** Where Save writes, short: a project's own section reads "for this
    project", since the toolbar's picker already names the project. */
function saveTarget(label: string): string {
  const [layer, where] = label.split(' · ');
  if (where === undefined) return layer!;
  return where.includes('/') ? `${layer} for this project` : label;
}

export function DraftEditor({
  def,
  form,
  initial,
  startIn = 'json',
  onMode,
  targetLabel,
  saving,
  replaceWith,
  reported = [],
  reveal = false,
  onSave,
  onCancel,
  onForm,
  showsDefault = false,
}: {
  def: SettingDefWire;
  form: FormShape | null;
  initial: unknown;
  /** `initial` is the registered default because no layer sets the key. */
  showsDefault?: boolean;
  startIn?: EditMode;
  onMode?: (mode: EditMode) => void;
  targetLabel: string;
  saving: boolean;
  /** Swaps the draft (form and JSON alike) for a value from elsewhere,
      such as a diverged older store's value. */
  replaceWith?: { label: string; value: unknown };
  /** The store's own issues on this layer, shown until their value is
      edited even where the local check passes it. */
  reported?: SchemaIssue[];
  /** Scrolls the first invalid field into view on mount. */
  reveal?: boolean;
  onSave: (value: unknown) => Promise<boolean>;
  onCancel: () => void;
  /** Leaves for a Form editor that lives outside this draft (a row with no
      form shape of its own); an edited draft asks before it is dropped. */
  onForm?: () => void;
}) {
  const { text: colors } = useSchemeColors();
  const start = initial ?? emptyOf(def);
  const schema = def.layerSchema ?? def.schema;
  const [mode, setModeState] = useState<EditMode>(
    form && startIn === 'form' && canDraw(form, start) ? 'form' : 'json'
  );
  const setMode = (next: EditMode) => {
    setModeState(next);
    onMode?.(next);
  };
  const [draft, setDraft] = useState<unknown>(() => structuredClone(start));
  const [text, setText] = useState(() => pretty(start));
  // The text as it stood when focus last left the editor; an issue shows
  // only while the text still matches it, so typing never flashes errors.
  const [blurredText, setBlurredText] = useState<string | null>(null);
  // Bumped whenever the draft is replaced wholesale (Use the older value),
  // keyed onto ItemCards/NamedSections so they remount from the new value
  // instead of keeping card ids, key order and per-field local state seeded
  // from the value they had at mount.
  const [formGeneration, setFormGeneration] = useState(0);
  // The stored index of each top-level entry, so a reported issue follows
  // its card; lost once the draft is rewritten outside the cards.
  const [origin, setOrigin] = useState<number[] | null>(() =>
    Array.isArray(start) ? start.map((_, i) => i) : null
  );

  const parsed: Parsed =
    mode === 'json' ? parse(text) : { ok: true, value: draft };
  const checked = parsed.ok && schema ? checkValue(schema, parsed.value) : [];
  const issues = parsed.ok
    ? [
        ...checked,
        ...standingIssues(reported, start, parsed.value, checked, origin),
      ]
    : checked;
  const keyNote = parsed.ok ? draftNote(def.key, parsed.value) : null;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reveal) return;
    root.current
      ?.querySelector('[aria-invalid="true"]')
      ?.scrollIntoView({ block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changed =
    parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(start);
  const fits = parsed.ok && form !== null && canDraw(form, parsed.value);

  // The form's touched fields at the switch to JSON, so an untouched new
  // card reads the same there; any edit to the JSON text counts as a touch.
  const formTouched = useRef<ReadonlyMap<CardKey, ReadonlySet<string>> | null>(
    null
  );
  const [jsonTouched, setJsonTouched] = useState<{
    text: string;
    touched: ReadonlyMap<CardKey, ReadonlySet<string>>;
  } | null>(null);
  const onTouched = (t: ReadonlyMap<CardKey, ReadonlySet<string>>) => {
    formTouched.current = t;
  };

  const toJson = () => {
    setOrigin(null);
    const next = pretty(draft);
    setText(next);
    setJsonTouched(
      formTouched.current ? { text: next, touched: formTouched.current } : null
    );
    setMode('json');
  };
  const toForm = () => {
    if (!parsed.ok || !fits) return;
    setDraft(parsed.value);
    setMode('form');
  };
  const leaveForForm = () => {
    if (!onForm) return;
    if (text === pretty(start)) return onForm();
    modals.confirm({
      title: 'Discard JSON changes?',
      message: 'Switching to the form drops the edits in this draft.',
      destructive: true,
      labels: { confirm: 'Discard', cancel: 'Keep editing' },
      onConfirm: onForm,
    });
  };
  const onKeyDown = cancelOnEscape(onCancel);

  // Where Save writes, beside Save. The project picker in the toolbar
  // already names the project, so the layer's own name is enough here.
  const target = saveTarget(targetLabel);
  // Just switched from the form, an untouched card's issues stay quiet.
  const fromForm =
    parsed.ok && jsonTouched && jsonTouched.text === text
      ? footerSummary(issues, jsonTouched.touched)
      : null;
  const jsonError = !parsed.ok
    ? parsed.message.replace(/^JSON Parse error: /, 'Invalid JSON: ')
    : fromForm
      ? (fromForm.touchedText ?? fromForm.fallbackText ?? fromForm.noteText)
      : issues[0]
        ? issueText(issues[0])
        : null;
  // Kept through the collapse, so the alert does not empty as it closes.
  const shownError = useRef(jsonError);
  if (jsonError !== null) shownError.current = jsonError;
  const footerEnd = (
    <>
      {showsDefault && changed ? (
        <Alert
          variant="tint"
          color="accent"
          py={2}
          px={8}
          data-testid="draft-save-target"
        >
          <Text fz={12}>
            {target === 'user'
              ? 'Saves to your user settings'
              : `Saves to ${target} settings`}
          </Text>
        </Alert>
      ) : (
        !showsDefault && (
          <Text fz={12} c={colors.muted}>
            {`Saves to ${target}`}
          </Text>
        )
      )}
      <Button size="compact-sm" variant="default" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="compact-sm"
        disabled={!parsed.ok || !changed || issues.length > 0 || saving}
        onClick={() => {
          if (parsed.ok) void onSave(parsed.value);
        }}
      >
        Save
      </Button>
    </>
  );

  return (
    <Stack ref={root} gap={10} onKeyDown={onKeyDown}>
      <PanelToolbar>
        <Group justify="flex-end" wrap="nowrap" gap={8}>
          {(form || onForm || replaceWith) && (
            <Group gap={8} wrap="nowrap">
              {form && mode === 'json' && !fits && (
                <Text fz={12} c={colors.muted}>
                  {parsed.ok
                    ? 'This value does not fit the form.'
                    : 'Fix the JSON to switch back to the form.'}
                </Text>
              )}
              {replaceWith && (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  onClick={() => {
                    setOrigin(null);
                    setDraft(structuredClone(replaceWith.value));
                    setText(pretty(replaceWith.value));
                    setFormGeneration(g => g + 1);
                    if (form && !canDraw(form, replaceWith.value))
                      setMode('json');
                  }}
                >
                  {replaceWith.label}
                </Button>
              )}
              {form ? (
                <ModeToggle
                  value={mode}
                  onChange={m => (m === 'json' ? toJson() : toForm())}
                  formDisabled={mode === 'json' && !fits}
                />
              ) : (
                onForm && (
                  <ModeToggle
                    value="json"
                    onChange={m => m === 'form' && leaveForForm()}
                  />
                )
              )}
            </Group>
          )}
        </Group>
      </PanelToolbar>
      {showsDefault && (
        <DraftNote
          color="accent"
          icon={<Icons.info size={14} />}
          testId="draft-default-note"
        >
          Currently set to the default value
        </DraftNote>
      )}
      {keyNote !== null && (
        <DraftNote
          color="warn"
          icon={<Icons.warning size={14} />}
          testId="draft-key-note"
        >
          {keyNote}
        </DraftNote>
      )}
      {mode === 'json' && (
        <div>
          <div
            onFocus={() => setBlurredText(null)}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setBlurredText(text);
            }}
          >
            <JsonDraft
              key={`${def.key}:${targetLabel}:${JSON.stringify(schema) ?? ''}`}
              text={text}
              onText={setText}
              schema={schema}
            />
          </div>
          <Collapse
            expanded={jsonError !== null && blurredText === text}
            transitionDuration={150}
            animateOpacity
          >
            <Alert
              variant="tint"
              color="bad"
              icon={<Icons.error size={14} />}
              w="fit-content"
              mt={10}
              py={4}
              px={10}
              styles={{ icon: { marginInlineEnd: 6 } }}
              data-testid="draft-issue"
            >
              <Text fz={12}>{shownError.current}</Text>
            </Alert>
          </Collapse>
        </div>
      )}
      {mode === 'form' && form?.kind === 'objectList' && (
        <ItemCards
          key={formGeneration}
          shape={form}
          value={draft as Entry[]}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
          footerEnd={footerEnd}
          issueTestId="draft-issue"
          onOrder={origin ? setOrigin : undefined}
          onTouched={onTouched}
        />
      )}
      {mode === 'form' && form?.kind === 'objectMap' && (
        <NamedSections
          key={formGeneration}
          shape={form}
          value={draft as Record<string, Entry>}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
          footerEnd={footerEnd}
          issueTestId="draft-issue"
          onTouched={onTouched}
        />
      )}
      {mode === 'json' && (
        <CardsFooter
          leading={null}
          summary={{ touchedText: null, noteText: null, fallbackText: null }}
          footerEnd={footerEnd}
        />
      )}
    </Stack>
  );
}
