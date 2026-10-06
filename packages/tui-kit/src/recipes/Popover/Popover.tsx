import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useState } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Popover.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 2 as const;

const VIEWPORT_MARGIN = 8;

const POPOVER_SELECTORS = ["root", "positioner", "popup"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const POPOVER_PARTS = {
  root: "popover",
  positioner: "popover-positioner",
  popup: "popover-popup",
} as const;

/** Popover's own props; `PopoverProps` below is the full public surface. */
export interface PopoverOwnProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger element: Base UI's Popover.Trigger renders it. */
  trigger: ReactElement;
  side?: "bottom" | "top";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  ariaLabel: string;
  children?: ReactNode;
}

export const Popover = defineComponent<
  PopoverOwnProps,
  typeof POPOVER_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Popover",
  selectors: POPOVER_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const { open, onOpenChange, trigger, side, align, sideOffset, ariaLabel, children } = props;
    const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);

    return (
      <BasePopover.Root open={open} onOpenChange={onOpenChange}>
        <BasePopover.Trigger render={trigger} />
        {/* Portals into an in-place, out-of-flow wrapper rather than `<body>`
            so a scoped `.dark` or theme wrapper around the caller still
            reaches the popup. */}
        <div
          ref={(node) => {
            setWrapper(node);
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          {...getStyles("root")}
          data-part={POPOVER_PARTS.root}
        />
        <BasePopover.Portal container={wrapper}>
          <BasePopover.Positioner
            side={side ?? "bottom"}
            align={align ?? "center"}
            sideOffset={sideOffset ?? 4}
            collisionPadding={VIEWPORT_MARGIN}
            {...getStyles("positioner")}
            data-part={POPOVER_PARTS.positioner}
          >
            <BasePopover.Popup
              aria-label={ariaLabel}
              {...getStyles("popup")}
              data-part={POPOVER_PARTS.popup}
            >
              {children}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type PopoverProps = ComponentProps<typeof Popover>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const popoverTheme = Popover.extend({});
