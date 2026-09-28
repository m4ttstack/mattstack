import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { autocompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { useComputedColorScheme } from '@mantine/core';
import { basicSetup } from 'codemirror';

import { kitHighlightStyle } from './highlightStyle';
import {
  jsonDiagnostics,
  jsonSchemaCompletion,
  type JsonSchemaCheck,
} from './jsonSchema';

export type { JsonPathIssue, JsonSchemaCheck } from './jsonSchema';

// Tags a transaction as originating from the `value`-sync effect (below)
// rather than from the user editing the document, so the update listener
// can skip calling `onChange` for it -- otherwise a controlled
// `value`+`onChange` pair would have every external `value` update
// immediately echoed straight back out through `onChange`.
const externalChange = Annotation.define<boolean>();

export type CodeMirrorLanguage = 'javascript' | 'json';

export interface CodeMirrorBaseProps {
  /** The editor's content. Uncontrolled if omitted; controlled (kept in sync on change) if provided. */
  value?: string;
  /** Fired with the new document text whenever the user edits the content. */
  onChange?: (value: string) => void;
  /** Enables syntax highlighting + language-aware editing for the given language. No language support when omitted. */
  language?: CodeMirrorLanguage;
  /** Blocks edits (the editor still allows selecting/copying text). @default false */
  readOnly?: boolean;
  /** CSS height of the editor. @default '300px' */
  height?: string;
  /** Adds a drag handle on the bottom edge. `height` is then only the
      starting height: a later change to it does not undo a drag. @default false */
  resizable?: boolean;
  /** Placeholder content shown when the editor is empty. */
  placeholder?: string;
  /** Focus the editor on mount. @default false */
  autoFocus?: boolean;
  /**
   * Extra `@codemirror/state` extensions appended to the editor's extension
   * list at creation (after the kit's basics/language/readOnly compartments,
   * before the theme) -- e.g. linting, autocompletion, custom keymaps. Read
   * once when the editor is created; changing this after mount does NOT
   * reconfigure the live editor (unlike `language`/`readOnly`, which are
   * held in compartments) -- remount the component (e.g. via `key`) to pick
   * up a new list.
   */
  extensions?: Extension[];
  /** Called once, right after the `EditorView` is created, with the view and its initial state. */
  onCreateEditor?: (view: EditorView, state: EditorState) => void;
  /** Called on every editor update (document changes, selection, focus, etc.), alongside `onChange`. */
  onUpdate?: (update: ViewUpdate) => void;
  /**
   * Overrides the kit's automatic scheme-aware theme. `'light'`/`'dark'`
   * force the kit's own chrome to that scheme; an `Extension` replaces the
   * theme entirely. Omitted (default): follows the computed color scheme.
   */
  theme?: 'light' | 'dark' | Extension;
  /** A JSON Schema for `language="json"`: completes property names and
      enum, const and boolean values. Reconfigures live. */
  jsonSchema?: Record<string, unknown>;
  /** Lints `language="json"`: a parse error, else each returned issue
      underlined at its path. The caller supplies the checker so the kit
      needs no validator and the messages match the caller's own. */
  jsonCheck?: JsonSchemaCheck;
}

/** Imperative handle exposed via `ref`: the live `EditorView`, or `null` before/after mount. */
export interface CodeMirrorRef {
  view: EditorView | null;
}

const MIN_RESIZABLE_HEIGHT_PX = 60;
const KEY_STEP_PX = 20;
const MAX_RESIZABLE_HEIGHT_PX = 2000;
const GRIP_STYLE = {
  flex: 'none',
  height: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'ns-resize',
  background: 'var(--ui-bg-4)',
  borderTop: '1px solid var(--mantine-color-default-border)',
  touchAction: 'none',
  outlineOffset: -2,
} as const;
const GRIP_BAR_STYLE = {
  width: 28,
  height: 3,
  borderRadius: 2,
  background: 'var(--mantine-color-dimmed)',
  opacity: 0.6,
} as const;

/**
 * Scheme-aware editor chrome. Colors reference the kit's CSS vars, so the
 * palette flips with the color scheme on its own; the `dark` flag flips
 * CodeMirror's OWN defaults (caret, selection, active line) that don't go
 * through our vars -- overridden below instead, since `@codemirror/view`'s
 * own dark active-line color is a fixed, too-heavy teal wash. The frame
 * polish (padding, theme radius) rides along.
 */
const editorTheme = (height: string, dark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        height,
        backgroundColor: 'var(--ui-bg-4)',
        color: 'var(--mantine-color-text)',
        borderRadius: 'var(--mantine-radius-default)',
        overflow: 'hidden',
      },
      '.cm-content': {
        padding: 'var(--mantine-spacing-xs)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--ui-bg-3)',
        color: 'var(--mantine-color-dimmed)',
        border: 'none',
      },
      '.cm-activeLine': {
        backgroundColor:
          'color-mix(in srgb, var(--mantine-color-text) var(--tk-wash), transparent)',
      },
      '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        {
          backgroundColor:
            'color-mix(in srgb, var(--tk-fill-accent) var(--tk-wash), transparent)',
        },
      // A squiggle/dot rendered from a raw hex data-uri (CodeMirror's own
      // lint theme) can't reference a CSS var, so the underline and gutter
      // marker are redrawn as plain CSS shapes on the bad/warn role tokens
      // instead -- legible in dark, where the stock red squiggle is not.
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--tk-text-bad-vivid)',
        textDecorationSkipInk: 'none',
      },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--tk-text-warn-vivid)',
        textDecorationSkipInk: 'none',
      },
      '.cm-lint-marker-error': {
        content: 'none',
        backgroundColor: 'var(--tk-text-bad-vivid)',
        borderRadius: '50%',
      },
      '.cm-lint-marker-warning': {
        content: 'none',
        backgroundColor: 'var(--tk-text-warn-vivid)',
        borderRadius: '50%',
      },
      // A zero-width or all-whitespace diagnostic range renders as a
      // `cm-lintPoint` widget instead of a `cm-lintRange` mark (see
      // @codemirror/lint's own LintState.init) -- reachable for a JSON
      // parse error anchored at a lezer error node, which is often
      // zero-width. Same token, different selector.
      '.cm-lintPoint-error': {
        '&:after': { borderBottomColor: 'var(--tk-text-bad-vivid)' },
      },
      '.cm-lintPoint-warning': {
        '&:after': { borderBottomColor: 'var(--tk-text-warn-vivid)' },
      },
    },
    { dark }
  );

const languageExtensions: Record<CodeMirrorLanguage, () => Extension> = {
  javascript: () => javascript(),
  json: () => json(),
};

function languageExtensionFor(
  language: CodeMirrorLanguage | undefined
): Extension {
  return language ? languageExtensions[language]() : [];
}

/**
 * Reads the schema/checker through refs rather than taking them as direct
 * arguments -- a caller that builds a fresh schema object or checker
 * function every render must not tear down and rebuild the completion/lint
 * extensions on every keystroke, which would close an open completion popup
 * and restart the lint debounce. The refs are read at call time instead, so
 * a changed schema/checker still takes effect on the next completion or
 * lint run without a reconfigure; only presence/absence (see the reconfigure
 * effect below) triggers one.
 */
function schemaExtensions(
  language: CodeMirrorLanguage | undefined,
  schemaRef: { current: Record<string, unknown> | undefined },
  checkRef: { current: JsonSchemaCheck | undefined }
): Extension[] {
  if (language !== 'json') return [];
  const out: Extension[] = [];
  if (schemaRef.current)
    out.push(
      autocompletion({
        override: [
          ctx =>
            schemaRef.current
              ? jsonSchemaCompletion(schemaRef.current)(ctx)
              : null,
        ],
      })
    );
  if (checkRef.current)
    out.push(
      linter(
        view =>
          checkRef.current ? jsonDiagnostics(view.state, checkRef.current) : [],
        { delay: 250 }
      ),
      lintGutter()
    );
  return out;
}

/**
 * Resolves the `theme` prop into the extension the theme compartment holds.
 * Omitted -> the auto scheme theme (follows the computed color scheme) plus
 * the kit's role-token syntax highlighting. `'light'` / `'dark'` -> the
 * kit's own chrome (and highlighting), forced to that scheme. An
 * `Extension` -> used as-is, replacing the kit's theme (and its chrome and
 * highlighting) entirely.
 */
function resolveThemeExtension(
  theme: 'light' | 'dark' | Extension | undefined,
  height: string,
  computedColorScheme: 'light' | 'dark'
): Extension {
  if (theme === undefined) {
    return [
      editorTheme(height, computedColorScheme === 'dark'),
      syntaxHighlighting(kitHighlightStyle),
    ];
  }
  if (theme === 'light' || theme === 'dark') {
    return [
      editorTheme(height, theme === 'dark'),
      syntaxHighlighting(kitHighlightStyle),
    ];
  }
  return theme;
}

/**
 * The real CodeMirror 6 editor: `@codemirror/*` + the `codemirror` meta
 * package's `basicSetup` (line numbers, history, bracket matching, default
 * keymap, etc.) are only ever imported by this module, which is itself only
 * ever reached through `CodeMirror.tsx`'s `React.lazy(() => import('./CodeMirror.Base'))`
 * -- so none of it enters the app's entry bundle.
 *
 * `language`/`readOnly`/`theme` are held in `Compartment`s so changing any
 * of those props reconfigures the live editor instead of tearing it down
 * and remounting. `extensions`, `onCreateEditor` are read once at creation
 * (see their prop docs above); `onUpdate` (like `onChange`) is read through
 * a ref so a fresh function identity each render doesn't force a remount.
 *
 * The `ref` (via `useImperativeHandle`) exposes the live `EditorView` as
 * `{ view }` -- a getter, so it stays correct across the create/destroy
 * effect without needing to be recomputed on every render.
 */
const CodeMirrorBase = /* @__PURE__ */ forwardRef<
  CodeMirrorRef,
  CodeMirrorBaseProps
>(function CodeMirrorBase(
  {
    value = '',
    onChange,
    language,
    readOnly = false,
    height = '300px',
    resizable = false,
    placeholder,
    autoFocus = false,
    extensions = [],
    onCreateEditor,
    onUpdate,
    theme,
    jsonSchema,
    jsonCheck,
  }: CodeMirrorBaseProps,
  ref
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // React only writes a style value that changed, so a constant start height
  // never overwrites the height a drag set on the frame; until a drag, the
  // effect below keeps the frame following `height`.
  const [startHeight] = useState(height);
  const dragged = useRef(false);
  const [ariaHeight, setAriaHeight] = useState(() => parseFloat(height) || 0);
  const editorHeight = resizable ? '100%' : height;
  const languageCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;
  const schemaCompartment = useRef(new Compartment()).current;

  // Resolved 'light' | 'dark' (never 'auto'), read synchronously on first
  // render -- same anti-flicker approach as the kit's useColorScheme.
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: false,
  });

  // Read through a ref inside the update listener so the listener extension
  // (baked into the state at creation time) always calls the *latest*
  // `onChange`/`onUpdate` without needing to tear down and recreate the view
  // whenever the caller passes a fresh function identity.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const jsonSchemaRef = useRef(jsonSchema);
  jsonSchemaRef.current = jsonSchema;
  const jsonCheckRef = useRef(jsonCheck);
  jsonCheckRef.current = jsonCheck;

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
    }),
    []
  );

  useEffect(() => {
    if (!parentRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of(update => {
      onUpdateRef.current?.(update);
      const isExternal = update.transactions.some(tr =>
        tr.annotation(externalChange)
      );
      if (update.docChanged && !isExternal) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const allExtensions: Extension[] = [
      basicSetup,
      keymap.of([indentWithTab]),
      languageCompartment.of(languageExtensionFor(language)),
      schemaCompartment.of(
        schemaExtensions(language, jsonSchemaRef, jsonCheckRef)
      ),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      updateListener,
      // User-supplied extensions, read once at creation -- see the
      // `extensions` prop doc for why this doesn't reconfigure live.
      ...extensions,
      themeCompartment.of(
        resolveThemeExtension(theme, editorHeight, computedColorScheme)
      ),
    ];
    if (placeholder) {
      allExtensions.push(placeholderExtension(placeholder));
    }

    const state = EditorState.create({ doc: value, extensions: allExtensions });
    const view = new EditorView({
      state,
      parent: parentRef.current,
    });
    viewRef.current = view;
    onCreateEditor?.(view, state);
    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once on mount; `value`/`language`/`readOnly`/`theme`
    // changes are pushed into the live view by the dedicated effects below
    // instead of recreating it (which would drop undo history + selection).
    // `extensions`/`onCreateEditor` are intentionally creation-time only --
    // see their prop docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external `value` changes into the live document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: [externalChange.of(true)],
      });
    }
  }, [value]);

  // Follow color-scheme/height/theme-override changes into the live editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(
        resolveThemeExtension(theme, editorHeight, computedColorScheme)
      ),
    });
  }, [computedColorScheme, editorHeight, theme, themeCompartment]);

  // Reconfigure the language compartment when `language` changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.reconfigure(languageExtensionFor(language)),
    });
  }, [language, languageCompartment]);

  // Reconfigure the readOnly compartment when `readOnly` changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        EditorState.readOnly.of(readOnly)
      ),
    });
  }, [readOnly, readOnlyCompartment]);

  // Reconfigure schema completion and lint when the language changes, or
  // when jsonSchema/jsonCheck go from absent to present (or back) -- not on
  // every render a caller passes a fresh schema object or checker function,
  // which schemaExtensions reads through the refs above instead. See
  // schemaExtensions' own doc comment for why.
  const hasJsonSchema = jsonSchema !== undefined;
  const hasJsonCheck = jsonCheck !== undefined;
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: schemaCompartment.reconfigure(
        schemaExtensions(language, jsonSchemaRef, jsonCheckRef)
      ),
    });
  }, [language, hasJsonSchema, hasJsonCheck, schemaCompartment]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || dragged.current) return;
    frame.style.height = height;
    setAriaHeight(parseFloat(height) || 0);
  }, [height]);

  const editor = (
    <div
      ref={parentRef}
      data-testid="codemirror-editor"
      style={resizable ? { flex: 1, minHeight: 0 } : undefined}
    />
  );
  if (!resizable) return editor;

  const resizeTo = (px: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const next = Math.max(MIN_RESIZABLE_HEIGHT_PX, px);
    dragged.current = true;
    frame.style.height = `${next}px`;
    setAriaHeight(next);
  };
  // jsdom lays nothing out, so the inline height is read before the measured one.
  const currentHeight = () => {
    const frame = frameRef.current;
    if (!frame) return 0;
    return (
      parseFloat(frame.style.height) || frame.getBoundingClientRect().height
    );
  };

  return (
    <div
      ref={frameRef}
      style={{
        height: startHeight,
        minHeight: MIN_RESIZABLE_HEIGHT_PX,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--mantine-radius-default)',
        overflow: 'hidden',
        background: 'var(--ui-bg-4)',
      }}
    >
      {editor}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize editor"
        aria-valuenow={ariaHeight}
        aria-valuemin={MIN_RESIZABLE_HEIGHT_PX}
        aria-valuemax={MAX_RESIZABLE_HEIGHT_PX}
        tabIndex={0}
        style={GRIP_STYLE}
        onPointerDown={e => {
          if (e.button !== 0) return;
          const startY = e.clientY;
          const startH = currentHeight();
          const move = (ev: PointerEvent) =>
            resizeTo(startH + ev.clientY - startY);
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
          e.preventDefault();
        }}
        onKeyDown={e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          resizeTo(
            currentHeight() +
              (e.key === 'ArrowDown' ? KEY_STEP_PX : -KEY_STEP_PX)
          );
        }}
      >
        <span style={GRIP_BAR_STYLE} />
      </div>
    </div>
  );
});

export default CodeMirrorBase;
