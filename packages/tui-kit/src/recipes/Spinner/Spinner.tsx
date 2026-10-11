import type { ComponentProps, HTMLAttributes } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Spinner.module.css";
import "./Spinner.keyframes.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SPINNER_SELECTORS = ["root"] as const;

export const SPINNER_PARTS = { root: "spinner" } as const;

/** Recipe scalar, not the theme's `size` vocabulary axis: a spinner has
    exactly the sizes its hosts need. `md` stands in for a 14px Icon, and an
    open arc reads smaller than a solid glyph of the same box. */
const SPINNER_SIZES: Record<NonNullable<SpinnerOwnProps["size"]>, string> = {
  xs: "calc(0.85em + 4px)",
  sm: "calc(1em + 4px)",
  md: "16px",
};

export interface SpinnerOwnProps {
  size?: "xs" | "sm" | "md";
}

type SpinnerProps_ = SpinnerOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const Spinner = defineComponent<
  SpinnerProps_,
  typeof SPINNER_SELECTORS,
  readonly [],
  readonly [],
  HTMLSpanElement
>({
  name: "Spinner",
  selectors: SPINNER_SELECTORS,
  classes,
  vars: (_theme, props) => ({
    root: { "--sb-spinner-size": SPINNER_SIZES[(props as SpinnerOwnProps).size ?? "sm"] },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      size,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <span
        ref={ref}
        aria-hidden
        {...rest}
        {...getStyles("root")}
        data-part={SPINNER_PARTS.root}
        data-size={size ?? "sm"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </span>
    );
  },
});

export type SpinnerProps = ComponentProps<typeof Spinner>;

export const spinnerTheme = Spinner.extend({});
