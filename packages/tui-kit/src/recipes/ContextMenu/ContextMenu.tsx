import { mergeRefs } from "@soribashi/core";
import type { PartRenderCtx } from "@soribashi/core";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defineCompound } from "../../builders.ts";
import { useEscapeClose } from "../../hooks/index.ts";
import classes from "./ContextMenu.module.css";
import "./ContextMenu.keyframes.css";

/** Authoring category (3 = persistent navigational compound). Read off this
    module by scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 3 as const;

/** The full declared slot set, NOT recoverable by unioning part names with
    CSS-module class keys: `hint` is a real style slot with no part, because a
    hint is a property OF an item and promoting it would let a call site render
    one outside any item. `submenu` and `chevron` are part-less for the same
    reason: both belong to a `Sub`. */
const CONTEXTMENU_SLOT_KEYS = [
  "root",
  "item",
  "label",
  "separator",
  "hint",
  "sub",
  "submenu",
  "chevron",
  "row",
] as const;

type ContextMenuSlotKey = (typeof CONTEXTMENU_SLOT_KEYS)[number];

/** Every part's render ctx. `object` for the extras (this compound publishes no
    `context()`) and `readonly []` for variants (it declares none), so
    `ctx.variant` is correctly `undefined`. */
type Ctx<TProps> = PartRenderCtx<TProps, object, readonly [], ContextMenuSlotKey>;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail on EVERY part: each has its own consumer-facing prop surface, so each
    could otherwise have its `data-part` replaced. */
export const CONTEXTMENU_PARTS = {
  root: "contextmenu",
  item: "contextmenu-item",
  label: "contextmenu-label",
  separator: "contextmenu-separator",
  hint: "contextmenu-hint",
  sub: "contextmenu-sub",
  submenu: "contextmenu-submenu",
  chevron: "contextmenu-chevron",
  row: "contextmenu-row",
} as const;

/** Viewport keep-out for the clamped menu, in CSS pixels. A plain number, not a
    spacing token: it is consumed in JS geometry, not in CSS. */
const VIEWPORT_MARGIN = 8;

const CONTEXTMENU_SCALARS = { minWidth: "200px" } as const;

/** Strips the Styles API's own config keys, which `useStyles` consumes and
    which are not valid DOM attributes. Every part needs this: `defineCompound`
    hands each part its own merged props untouched. */
function stripFrameworkKeys<
  T extends Partial<
    Record<"classNames" | "styles" | "vars" | "attributes" | "unstyled", unknown>
  >,
>(props: T): Omit<T, "classNames" | "styles" | "vars" | "attributes" | "unstyled"> {
  const {
    classNames: _classNames,
    styles: _styles,
    vars: _vars,
    attributes: _attributes,
    unstyled: _unstyled,
    ...rest
  } = props;
  return rest;
}

/** The root part's own props; `ContextMenuProps` below is the full surface. */
export interface ContextMenuOwnProps {
  /** Requested viewport x of the anchor point (typically `event.clientX`).
      CLAMPED, not obeyed — see the layout effect. */
  x: number;
  /** Requested viewport y of the anchor point (`event.clientY`). */
  y: number;
  /** The menu's accessible name (`aria-label` on the root). */
  ariaLabel: string;
  /** Called on Escape, on a mousedown outside, on scroll, and on resize. NOT
      called when an item is clicked — closing after an action is the caller's
      decision (mr-board's Slack-mark items deliberately stay open). */
  onClose: () => void;
  /** A focusable descendant to focus once, after the clamp commits. The menu is
      `visibility: hidden` until measured, and such a subtree cannot take focus
      at all — so a child's own `autoFocus`, or a focus call from a passive
      effect, silently no-ops. This prop is correctly ordered against the clamp.
      Omit it and nothing steals focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called every time the clamped position commits, including on a later
      re-clamp — unlike `initialFocusRef`, which fires once per mount. */
  onPositioned?: () => void;
  children?: ReactNode;
}

type ContextMenuRootProps_ = ContextMenuOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Item` part's own props — mr-board's `MenuItem` signature verbatim. */
export interface ContextMenuItemOwnProps {
  /** The item's leading text. A ReactNode: callers pass fragments. */
  label: ReactNode;
  /** Right-hand annotation. Rendered into the `hint` slot, and IGNORED when
      `trailing` is given. */
  hint?: string;
  /** An arbitrary right-hand node that REPLACES the hint. */
  trailing?: ReactNode;
  /** Disables the underlying `<button>`; styling follows from `:disabled`. */
  disabled?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

type ContextMenuItemProps_ = ContextMenuItemOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "children" | "disabled" | "onClick">;

/** The `Label` part's own props: a section heading at the top of the menu. */
export interface ContextMenuLabelOwnProps {
  children?: ReactNode;
}

type ContextMenuLabelProps_ = ContextMenuLabelOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Separator` part declares no own props, so its internal props type is
    just the DOM attribute surface. */
type ContextMenuSeparatorProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** @deprecated Separator has no fields of its own, so this was always the full
    DOM attribute surface — the opposite of what `OwnProps` means for its
    siblings. Prefer `ContextMenuSeparatorProps`. */
export type ContextMenuSeparatorOwnProps = ContextMenuSeparatorProps_;

/** The `Sub` part's own props: a row that opens a nested menu. */
export interface ContextMenuSubOwnProps {
  /** The row's leading text; a chevron follows it. */
  label: ReactNode;
  /** The nested menu's accessible name. */
  ariaLabel: string;
  /** Disables the row's `<button>`, and a disabled Sub never opens. */
  disabled?: boolean;
  /** The nested menu's items. */
  children?: ReactNode;
}

type ContextMenuSubProps_ = ContextMenuSubOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

type ContextMenuRowProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref">;

/** The open panel of a `Sub`. Mounted only while open, so its
    `useEscapeClose` sits above the root's on the layer stack and Escape
    closes this panel first.

    Positioned `absolute` against the Sub's own box, NOT `fixed` like the
    root: the root's entry animation puts a transform on it, which makes it
    the containing block of any fixed descendant, so a fixed panel opened
    during that animation would be offset by the root's own position and
    stay there. The clamp works in viewport geometry, then converts to offsets
    from the row, which sits at the origin of the Sub's box. */
function SubPanel({
  anchorRef,
  onClose,
  focusFirst,
  styleProps,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  focusFirst: boolean;
  styleProps: { className?: string; style?: CSSProperties };
  label: string;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEscapeClose(onClose);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const fitsRight = r.right + width + VIEWPORT_MARGIN <= window.innerWidth;
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(r.top, window.innerHeight - height - VIEWPORT_MARGIN),
    );
    setPos({
      left: fitsRight ? anchor.offsetWidth : Math.max(-width, VIEWPORT_MARGIN - r.left),
      top: top - r.top,
    });
  }, [anchorRef]);

  // Keyed on the committed `pos`: the panel is `visibility: hidden` until
  // then, and a hidden subtree cannot take focus.
  useLayoutEffect(() => {
    if (pos && focusFirst)
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [pos, focusFirst]);

  const anchored: CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: 0, top: 0, visibility: "hidden" };
  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      {...styleProps}
      style={{ ...styleProps.style, ...anchored }}
      data-part={CONTEXTMENU_PARTS.submenu}
      onKeyDown={(e) => {
        // Stopped so an outer Sub's panel does not close as well.
        if (e.key === "ArrowLeft") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

export const ContextMenu = defineCompound({
  name: "ContextMenu",
  classes,
  slotKeys: CONTEXTMENU_SLOT_KEYS,
  // Two `defineCompound` facts that apply nowhere else in the kit: it has no
  // automatic autoVars fallback at all (so there is nothing this resolver could
  // be replacing), and its `getStyles` takes an OPTIONS OBJECT — a part styling
  // its own slot calls `getStyles()`, one reaching across calls
  // `getStyles({ part: 'hint' })`. The bare-string form does not typecheck.
  vars: () => ({ root: { "--sb-contextmenu-min-w": CONTEXTMENU_SCALARS.minWidth } }),
  parts: {
    root: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRootProps_>) => {
        const {
          x,
          y,
          ariaLabel,
          onClose,
          initialFocusRef,
          onPositioned,
          children: _children,
          ...rest
        } = stripFrameworkKeys(props);

        // A part's `render` runs inside the builder's own forwardRef component
        // body on every render, so these hooks obey the rules of hooks normally.
        const menuRef = useRef<HTMLDivElement | null>(null);
        const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
        // A plain mutable ref, not state: flipping it must not schedule a render.
        const hasFocusedRef = useRef(false);

        // The recipe needs its own handle on the element (to measure it, and to
        // answer "was that mousedown inside me?") while a consumer may still
        // pass a ref. Memoised on `ref`: `mergeRefs` returns a fresh callback
        // per call, and a fresh identity every render would make React detach
        // and re-attach it each time.
        const setRefs = useMemo(() => mergeRefs(menuRef, ref), [ref]);

        // Keep the menu on screen: render once at the requested point (hidden,
        // see `anchored`), measure, then clamp both axes. `useLayoutEffect` so
        // the correction commits before paint — with useEffect the menu jumps.
        //
        // `offsetWidth`/`offsetHeight`, NOT `getBoundingClientRect()`: the entry
        // animation opens on `scale(0.97)` and is already running when this
        // fires, so a rect measure clamps against a box 3% narrower than the one
        // that lands, and the settled menu overhangs its margin by ~6px.
        //
        // Deps are `[x, y]` only. A consumer whose menu changes size (mr-board's
        // note mode) gives it a fresh React `key` to remount and re-measure —
        // the shell cannot know about a consumer's modes.
        useLayoutEffect(() => {
          const el = menuRef.current;
          if (!el) return;
          const width = el.offsetWidth;
          const height = el.offsetHeight;
          setPos({
            left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
            top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
          });
        }, [x, y]);

        // Its own effect, keyed on the COMMITTED `pos` rather than the requested
        // `[x, y]` — they run on different renders. By the time this body runs,
        // `setPos` has landed as `visibility` flipping to visible: the earliest
        // point a focus call can succeed, and still pre-paint.
        useLayoutEffect(() => {
          if (!pos) return;
          onPositioned?.();
          if (initialFocusRef && !hasFocusedRef.current) {
            hasFocusedRef.current = true;
            initialFocusRef.current?.focus();
          }
        }, [pos, onPositioned, initialFocusRef]);

        useEscapeClose(onClose);

        // Note the shapes: `mousedown` (not click) so the menu is gone before
        // the underlying element's own click handler runs; `scroll` in the
        // CAPTURE phase, because scroll does not bubble from a scrolling
        // descendant to window.
        useEffect(() => {
          const onDown = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) onClose();
          };
          document.addEventListener("mousedown", onDown);
          window.addEventListener("scroll", onClose, true);
          window.addEventListener("resize", onClose);
          return () => {
            document.removeEventListener("mousedown", onDown);
            window.removeEventListener("scroll", onClose, true);
            window.removeEventListener("resize", onClose);
          };
        }, [onClose]);

        // Before the first measurement there is no honest position to paint at,
        // so the menu is laid out (it must be, to be measurable) but not shown.
        const anchored: CSSProperties = pos
          ? { left: pos.left, top: pos.top }
          : { left: x, top: y, visibility: "hidden" };
        // Merged, not replaced: getStyles() has already folded in the consumer's
        // own `style` and the universal style props.
        const rootStyles = getStyles();

        return (
          <div
            ref={setRefs}
            role="menu"
            {...rest}
            {...rootStyles}
            style={{ ...rootStyles.style, ...anchored }}
            data-part={CONTEXTMENU_PARTS.root}
            aria-label={ariaLabel}
          >
            {children}
          </div>
        );
      },
    },
    item: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuItemProps_>) => {
        const { label, hint, trailing, ...rest } = stripFrameworkKeys(props);
        return (
          <button
            ref={ref as Ref<HTMLButtonElement>}
            role="menuitem"
            type="button"
            // `disabled` and `onClick` stay in `rest` deliberately: both are
            // real button attributes that need no translation.
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.item}
          >
            {/* The label's <span> carries no slot because the board gives it no
                class either: it exists so space-between has two children. */}
            <span>{label}</span>
            {trailing ??
              (hint ? (
                <span {...getStyles({ part: "hint" })} data-part={CONTEXTMENU_PARTS.hint}>
                  {hint}
                </span>
              ) : null)}
          </button>
        );
      },
    },
    label: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuLabelProps_>) => {
        const { children: _children, ...rest } = stripFrameworkKeys(props);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.label}
          >
            {children}
          </div>
        );
      },
    },
    separator: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuSeparatorProps_>) => (
        <div
          ref={ref as Ref<HTMLDivElement>}
          role="separator"
          {...stripFrameworkKeys(props)}
          {...getStyles()}
          data-part={CONTEXTMENU_PARTS.separator}
        />
      ),
    },
    sub: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuSubProps_>) => {
        const { label, ariaLabel, disabled, children, ...rest } = stripFrameworkKeys(props);
        // Hooks are legal here for the same reason as in the root's render.
        const [open, setOpen] = useState<null | "pointer" | "keyboard">(null);
        const buttonRef = useRef<HTMLButtonElement | null>(null);
        const close = useCallback(() => {
          setOpen(null);
          buttonRef.current?.focus();
        }, []);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.sub}
            onMouseEnter={() => {
              if (!disabled) setOpen((o) => o ?? "pointer");
            }}
            onMouseLeave={() => setOpen(null)}
          >
            <button
              ref={buttonRef}
              role="menuitem"
              type="button"
              aria-haspopup="menu"
              aria-expanded={open !== null}
              disabled={disabled}
              {...getStyles({ part: "item" })}
              data-part={CONTEXTMENU_PARTS.item}
              onClick={() => setOpen((o) => o ?? "pointer")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen("keyboard");
                }
              }}
            >
              <span>{label}</span>
              <span
                {...getStyles({ part: "chevron" })}
                data-part={CONTEXTMENU_PARTS.chevron}
                aria-hidden="true"
              >
                ›
              </span>
            </button>
            {open && (
              <SubPanel
                anchorRef={buttonRef}
                onClose={close}
                focusFirst={open === "keyboard"}
                styleProps={getStyles({ part: "submenu" })}
                label={ariaLabel}
              >
                {children}
              </SubPanel>
            )}
          </div>
        );
      },
    },
    row: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRowProps_>) => {
        const { children: _children, ...rest } = stripFrameworkKeys(props);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            role="group"
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.row}
          >
            {children}
          </div>
        );
      },
    },
  },
});

/** Everything a call site may pass to the menu itself, own props included. */
export type ContextMenuProps = ComponentProps<typeof ContextMenu>;
/** Everything a call site may pass to `<ContextMenu.Item>`. */
export type ContextMenuItemProps = ComponentProps<typeof ContextMenu.Item>;
/** Everything a call site may pass to `<ContextMenu.Label>`. */
export type ContextMenuLabelProps = ComponentProps<typeof ContextMenu.Label>;
/** Everything a call site may pass to `<ContextMenu.Separator>`. */
export type ContextMenuSeparatorProps = ComponentProps<typeof ContextMenu.Separator>;
/** Everything a call site may pass to `<ContextMenu.Sub>`. */
export type ContextMenuSubProps = ComponentProps<typeof ContextMenu.Sub>;
/** Everything a call site may pass to `<ContextMenu.Row>`. */
export type ContextMenuRowProps = ComponentProps<typeof ContextMenu.Row>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from.
    Compound PARTS carry their own `.extend` too (registered as
    `ContextMenuItem`/`ContextMenuLabel`/`ContextMenuSeparator`/`ContextMenuSub`/
    `ContextMenuRow`). */
export const contextMenuTheme = ContextMenu.extend({});
