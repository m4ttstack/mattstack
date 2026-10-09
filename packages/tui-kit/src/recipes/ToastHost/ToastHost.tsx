import type { ComponentProps, HTMLAttributes, Ref } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { defineComponent } from "../../builders.ts";
import type { Toast } from "../../hooks/index.ts";
import { CHECK_ICON, CROSS_ICON, Icon } from "../Icon/Icon.tsx";
import { Spinner } from "../Spinner/Spinner.tsx";
import classes from "./ToastHost.module.css";
import "./ToastHost.keyframes.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

/** `root` is the fixed-position stack; `toast` is one entry; `status` is the
    spinner, check or cross a toast that tracks work leads with. */
const TOASTHOST_SELECTORS = ["root", "toast", "status"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const TOASTHOST_PARTS = {
  root: "toasthost",
  toast: "toasthost-toast",
  status: "toasthost-status",
} as const;

/** Verbatim mr-board value. A fixed position offset, outside the spacing
    ladder's padding-margin-gap scope, so it gets a recipe-local property. */
const TOASTHOST_SCALARS: Record<string, string> = {
  "--sb-toasthost-offset": "16px",
};

/** How long a removed toast stays on screen playing its exit; matches the
    `toasthost-out` animation in ToastHost.keyframes.css. */
export const TOAST_EXIT_MS = 250;

type ShownToast = Toast & { leaving?: boolean };

/** The queue as drawn: the live toasts, plus each one the hook just dropped,
    kept for TOAST_EXIT_MS and flagged `leaving` so it can animate out. */
function useShownToasts(toasts: Toast[]): ShownToast[] {
  const [shown, setShown] = useState<ShownToast[]>(toasts);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useLayoutEffect(() => {
    const prev = shownRef.current;
    const live = new Map(toasts.map((t) => [t.id, t]));
    const known = new Set(prev.map((t) => t.id));
    const next: ShownToast[] = [
      ...prev.map((t) => live.get(t.id) ?? { ...t, leaving: true }),
      ...toasts.filter((t) => !known.has(t.id)),
    ];
    for (const t of next) {
      if (!t.leaving || timers.current.has(t.id)) continue;
      timers.current.set(
        t.id,
        setTimeout(() => {
          timers.current.delete(t.id);
          setShown((s) => s.filter((x) => x.id !== t.id));
        }, TOAST_EXIT_MS),
      );
    }
    setShown(next);
  }, [toasts]);
  useLayoutEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return shown;
}

/** ToastHost's own props; `ToastHostProps` below is the full public surface. */
export interface ToastHostOwnProps {
  /** The live queue, straight from `useToasts()`. Its `Toast` type is imported
      from the hook rather than redeclared, so the two stay one type. */
  toasts: Toast[];
}

type ToastHostProps_ = ToastHostOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref">;

export const ToastHost = defineComponent<
  ToastHostProps_,
  typeof TOASTHOST_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "ToastHost",
  selectors: TOASTHOST_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: ToastHost declares no `variants`.
  vars: (_theme, _props) => ({ root: { ...TOASTHOST_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      toasts,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <ToastStack
        toasts={toasts}
        rootRef={ref}
        rest={rest}
        styles={{
          root: getStyles("root"),
          toast: getStyles("toast"),
          status: getStyles("status"),
        }}
      />
    );
  },
});

/** The stack itself, a component of its own so it can hold the exit state:
    `render` above is a plain function, not a place for hooks. */
function ToastStack({
  toasts,
  rootRef,
  rest,
  styles,
}: {
  toasts: Toast[];
  rootRef: Ref<HTMLDivElement>;
  rest: HTMLAttributes<HTMLDivElement>;
  styles: Record<(typeof TOASTHOST_SELECTORS)[number], HTMLAttributes<HTMLElement>>;
}) {
  const shown = useShownToasts(toasts);
  // An empty queue renders NOTHING, not a hidden fixed-position box sitting
  // over the page.
  if (shown.length === 0) return null;

  return (
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      {...rest}
      {...styles.root}
      data-part={TOASTHOST_PARTS.root}
    >
      {shown.map((t) => (
        <div
          key={t.id}
          {...styles.toast}
          data-part={TOASTHOST_PARTS.toast}
          data-state={t.state}
          data-leaving={t.leaving || undefined}
          aria-hidden={t.leaving || undefined}
        >
          {t.state && (
            <span {...styles.status} data-part={TOASTHOST_PARTS.status}>
              {t.state === "pending" ? (
                <Spinner size="sm" />
              ) : (
                <Icon d={t.state === "done" ? CHECK_ICON : CROSS_ICON} />
              )}
            </span>
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Everything a call site may pass, own props included. */
export type ToastHostProps = ComponentProps<typeof ToastHost>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const toastHostTheme = ToastHost.extend({});
