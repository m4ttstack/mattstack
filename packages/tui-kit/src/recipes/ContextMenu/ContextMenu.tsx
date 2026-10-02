import { Menu } from "@base-ui/react/menu";
import { mergeRefs } from "@soribashi/core";
import type { PartRenderCtx } from "@soribashi/core";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defineCompound } from "../../builders.ts";
import { useEscapeClose } from "../../hooks/index.ts";
import { ICONS } from "../Icon/Icon.tsx";
import classes from "./ContextMenu.module.css";
import "./ContextMenu.keyframes.css";

/** Authoring category (3 = persistent navigational compound). Read off this
    module by scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 3 as const;

/** The full declared slot set, NOT recoverable by unioning part names with
    CSS-module class keys: `hint` is a real style slot with no part, because a
    hint is a property OF an item and promoting it would let a call site render
    one outside any item. `submenu` and `chevron` are part-less for the same
    reason: both belong to a `Sub`. `positioner` is Base UI's positioning box
    around the root's and every Sub's popup. */
const CONTEXTMENU_SLOT_KEYS = [
  "root",
  "positioner",
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

/** Viewport keep-out for the menu and its submenus, in CSS pixels. A plain
    number, not a spacing token: Base UI's collision padding takes a number. */
const VIEWPORT_MARGIN = 8;

/** The root's padding (`--spacing-px4`) plus its 1px border, and the same for a
    submenu's popup. Offsetting a submenu by it docks the panel on the root's
    outer edge and lines its first item up with the trigger row. Keep in step
    with `.root` and `.submenu` in ContextMenu.module.css. */
const SUBMENU_INSET = 5;

const CONTEXTMENU_SCALARS = { minWidth: "200px" } as const;

/** Shift on both axes and never flip: a point near an edge is clamped back
    inside the margin, as the hand-placed menu always was. The positioner
    also needs `sticky`, or Base UI limits the shift to keep the popup
    touching its anchor, and a point past the edge leaves it off screen. */
const CLAMP = { side: "shift", align: "shift" } as const;

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

type CloseDetails = Pick<Menu.Root.ChangeEventDetails, "reason" | "cancel" | "allowPropagation">;

/** Escape belongs to the layer stack, so Base UI's own Escape close is
    cancelled. It must still be allowed to propagate: Base UI's popup handler
    otherwise stops it before it reaches the stack's `document` listener.
    Returns whether it cancelled. */
function deferEscape(details: CloseDetails): boolean {
  if (details.reason !== "escape-key") return false;
  details.cancel();
  details.allowPropagation();
  return true;
}

/** Close requests the root never acts on, so `onClose` keeps its documented
    triggers.
    - `outside-press`: the recipe's own mousedown listener decides outside
      clicks. Base UI's fires on a capture-phase pointerdown, before a
      trigger's own handler can claim the press.
    - `focus-out`: Tab moving focus out of the menu leaves it open. */
const ROOT_IGNORED_CLOSES: ReadonlySet<string> = new Set(["outside-press", "focus-out"]);

/** Base UI keeps a disabled item focusable through `aria-disabled` and strips
    the native attribute. An Item keeps the native one, which the board
    asserts: it is inert to the pointer and skipped by the arrow keys (Base
    UI's navigation skips `:disabled`). So Base UI is never told an Item is
    disabled, and the button carries it instead. */
function buttonRender(disabled: boolean | undefined) {
  return (props: ComponentProps<"button">) => (
    <button
      {...props}
      type="button"
      disabled={disabled}
      aria-disabled={disabled ? undefined : props["aria-disabled"]}
    />
  );
}

/** Joins the layer stack for as long as it is mounted. */
function EscapeLayer({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose);
  return null;
}

/** The root part's own props; `ContextMenuProps` below is the full surface. */
export interface ContextMenuOwnProps {
  /** Requested viewport x of the anchor point (typically `event.clientX`).
      CLAMPED inside the viewport margin, not obeyed. */
  x: number;
  /** Requested viewport y of the anchor point (`event.clientY`). */
  y: number;
  /** The menu's accessible name (`aria-label` on the root). */
  ariaLabel: string;
  /** Called on Escape, on a mousedown outside, on scroll, and on resize. NOT
      called when an item is clicked: closing after an action is the caller's
      decision (mr-board's Slack-mark items deliberately stay open). */
  onClose: () => void;
  /** A focusable descendant to focus once, as soon as the menu mounts. Without
      it, the menu itself takes focus so the arrow keys work. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called once the menu's element is laid out, and again whenever (x, y)
      moves it, so a consumer can measure it and re-anchor. */
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
  /** A disabled Sub never opens. Its row stays focusable (Base UI's
      `aria-disabled` model), unlike a disabled Item. */
  disabled?: boolean;
  /** The nested menu's items. */
  children?: ReactNode;
}

type ContextMenuSubProps_ = ContextMenuSubOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

type ContextMenuRowProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref">;

export const ContextMenu = defineCompound({
  name: "ContextMenu",
  classes,
  slotKeys: CONTEXTMENU_SLOT_KEYS,
  // Two `defineCompound` facts that apply nowhere else in the kit: it has no
  // automatic autoVars fallback at all (so there is nothing this resolver could
  // be replacing), and its `getStyles` takes an OPTIONS OBJECT — a part styling
  // its own slot calls `getStyles()`, one reaching across calls
  // `getStyles({ part: 'hint' })`. The bare-string form does not typecheck.
  //
  // `submenu` gets its own copy: its popup is a sibling of the root's, not a
  // descendant, so it cannot inherit the root's.
  vars: () => ({
    root: { "--sb-contextmenu-min-w": CONTEXTMENU_SCALARS.minWidth },
    submenu: { "--sb-contextmenu-min-w": CONTEXTMENU_SCALARS.minWidth },
  }),
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
        const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
        const triggerId = useId();
        const [popup, setPopup] = useState<HTMLDivElement | null>(null);
        // A plain mutable ref, not state: flipping it must not schedule a render.
        const hasFocusedRef = useRef(false);

        // Focusing from the popup's ref callback runs before Base UI's focus
        // manager records where focus was; finding it already inside the
        // popup, Base UI skips its own initial focus (the first tabbable, which
        // could be a form field) instead of overriding this one. Children's
        // refs attach before this one, so the target is already set.
        const attachPopup = useCallback(
          (el: HTMLDivElement | null) => {
            setPopup(el);
            if (!el || hasFocusedRef.current) return;
            hasFocusedRef.current = true;
            (initialFocusRef?.current ?? el).focus();
          },
          [initialFocusRef],
        );
        // Memoised on `ref`: `mergeRefs` returns a fresh callback per call, and
        // a fresh identity every render would make React detach and re-attach
        // it each time.
        const setRefs = useMemo(() => mergeRefs(attachPopup, ref), [attachPopup, ref]);

        const anchor = useMemo(
          () => ({ getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }),
          [x, y],
        );

        useLayoutEffect(() => {
          if (popup) onPositioned?.();
        }, [popup, x, y, onPositioned]);

        useEscapeClose(onClose);

        // Focus goes back only if it was lost with the menu (it is on <body>).
        // Base UI's own return is off: it picks its target while this menu
        // unmounts, before a menu mounting in the same commit (a keyed stage
        // swap) has taken focus, and would pull focus away from it.
        const [returnTarget] = useState(() =>
          typeof document === "undefined" ? null : document.activeElement,
        );
        useEffect(
          () => () => {
            queueMicrotask(() => {
              const active = document.activeElement;
              if ((active === null || active === document.body) && returnTarget?.isConnected)
                (returnTarget as HTMLElement).focus?.();
            });
          },
          [returnTarget],
        );

        // `mousedown` (not click) so the menu is gone before the underlying
        // element's own click handler runs; `scroll` in the CAPTURE phase,
        // because scroll does not bubble from a scrolling descendant to window.
        useEffect(() => {
          const onDown = (e: MouseEvent) => {
            if (!wrapper?.contains(e.target as Node)) onClose();
          };
          document.addEventListener("mousedown", onDown);
          window.addEventListener("scroll", onClose, true);
          window.addEventListener("resize", onClose);
          return () => {
            document.removeEventListener("mousedown", onDown);
            window.removeEventListener("scroll", onClose, true);
            window.removeEventListener("resize", onClose);
          };
        }, [onClose, wrapper]);

        const rootStyles = getStyles();

        // The menu and every submenu portal into this in-place wrapper, not
        // `<body>`, so a scoped `.dark` or theme wrapper around the caller
        // still reaches them. It is out of flow rather than `display:
        // contents`: Base UI's guard spans and portal div would otherwise
        // become items of a grid or flex parent and add its row gap.
        return (
          <div
            ref={setWrapper}
            style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0 }}
          >
            <Menu.Root
              open
              triggerId={triggerId}
              modal={false}
              onOpenChange={(open, details) => {
                if (open || deferEscape(details)) return;
                if (ROOT_IGNORED_CLOSES.has(details.reason)) details.cancel();
                else onClose();
              }}
            >
              {/* Never shown or focused. The root's trigger (`triggerId`) gives
                  it its floating-tree node, which is how Base UI knows the
                  submenus are its children (keyboard entry, focus, and which
                  menu a key belongs to). Base UI's `ContextMenu.Root` would
                  supply one without it, but it is always modal: a backdrop
                  over the page and a scroll lock. */}
              <Menu.Trigger
                id={triggerId}
                render={<span hidden />}
                nativeButton={false}
                tabIndex={-1}
              />
              <Menu.Portal container={wrapper}>
                <Menu.Positioner
                  anchor={anchor}
                  positionMethod="fixed"
                  side="bottom"
                  align="start"
                  collisionAvoidance={CLAMP}
                  collisionPadding={VIEWPORT_MARGIN}
                  sticky
                  {...getStyles({ part: "positioner" })}
                >
                  <Menu.Popup
                    ref={setRefs}
                    finalFocus={false}
                    {...rest}
                    {...rootStyles}
                    data-part={CONTEXTMENU_PARTS.root}
                    aria-labelledby={undefined}
                    aria-label={ariaLabel}
                  >
                    {children}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>
        );
      },
    },
    item: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuItemProps_>) => {
        const { label, hint, trailing, disabled, onClick, ...rest } = stripFrameworkKeys(props);
        return (
          <Menu.Item
            ref={ref as Ref<HTMLButtonElement>}
            render={buttonRender(disabled)}
            nativeButton
            closeOnClick={false}
            {...(rest as Omit<Menu.Item.Props, "onClick">)}
            onClick={(e) => {
              onClick?.(e as unknown as ReactMouseEvent<HTMLButtonElement>);
              // Base UI's own click handlers run after this one, and one
              // refocuses the clicked item. The caller owns where focus goes
              // next (often back to whatever opened the menu).
              e.preventBaseUIHandler();
            }}
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
          </Menu.Item>
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
        <Menu.Separator
          ref={ref as Ref<HTMLDivElement>}
          {...stripFrameworkKeys(props)}
          {...getStyles()}
          data-part={CONTEXTMENU_PARTS.separator}
        />
      ),
    },
    sub: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuSubProps_>) => {
        const { label, ariaLabel, disabled, children, ...rest } = stripFrameworkKeys(props);
        // Controlled so the layer stack, not Base UI, closes it on Escape.
        const [open, setOpen] = useState(false);
        const close = useCallback(() => setOpen(false), []);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.sub}
          >
            <Menu.SubmenuRoot
              open={open}
              disabled={disabled}
              onOpenChange={(next, details) => {
                if (next || !deferEscape(details)) setOpen(next);
              }}
            >
              <Menu.SubmenuTrigger
                render={<button type="button" />}
                nativeButton
                {...getStyles({ part: "item" })}
                data-part={CONTEXTMENU_PARTS.item}
              >
                <span>{label}</span>
                <span
                  {...getStyles({ part: "chevron" })}
                  data-part={CONTEXTMENU_PARTS.chevron}
                  aria-hidden="true"
                >
                  {ICONS["chevron-right"]}
                </span>
              </Menu.SubmenuTrigger>
              {open && <EscapeLayer onClose={close} />}
              <Menu.Portal>
                <Menu.Positioner
                  positionMethod="fixed"
                  sideOffset={SUBMENU_INSET}
                  alignOffset={-SUBMENU_INSET}
                  collisionPadding={VIEWPORT_MARGIN}
                  {...getStyles({ part: "positioner" })}
                >
                  <Menu.Popup
                    {...getStyles({ part: "submenu" })}
                    data-part={CONTEXTMENU_PARTS.submenu}
                    aria-labelledby={undefined}
                    aria-label={ariaLabel}
                  >
                    {children}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
          </div>
        );
      },
    },
    row: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRowProps_>) => {
        const { children: _children, ...rest } = stripFrameworkKeys(props);
        return (
          <Menu.Group
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.row}
          >
            {children}
          </Menu.Group>
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
