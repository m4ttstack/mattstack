import { Combobox } from "@base-ui/react/combobox";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./SearchSelect.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 2 as const;

const SEARCHSELECT_SELECTORS = [
  "root", "label", "trigger", "value", "chevron", "portal", "positioner",
  "popup", "search", "list", "groupLabel", "item", "itemIcon", "itemLabel",
  "itemDetail", "empty", "footer",
] as const;

/** Measures with no theme rung, routed through recipe-local custom properties. */
const SEARCHSELECT_SCALARS = {
  maxHeight: "24rem",
  tracking: "0.04em",
  itemHeight: "1.875rem",
  hover: "color-mix(in srgb, var(--fg) 6%, transparent)",
} as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const SEARCHSELECT_PARTS = {
  root: "search-select",
  trigger: "search-select-trigger",
  popup: "search-select-popup",
  item: "search-select-item",
} as const;

export interface SearchSelectItem {
  value: string;
  label: string;
  /** Items sharing a group render under one label, after the ungrouped ones. */
  group?: string;
  icon?: ReactNode;
  detail?: ReactNode;
}

/** SearchSelect's own props; `SearchSelectProps` below is the full public surface. */
export interface SearchSelectOwnProps {
  items: SearchSelectItem[];
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  searchPlaceholder?: string;
  emptyText?: string;
  footer?: ReactNode;
}

interface Group {
  value: string;
  items: SearchSelectItem[];
}

function grouped(items: SearchSelectItem[]): Group[] {
  const order: string[] = [];
  const byKey = new Map<string, SearchSelectItem[]>();
  for (const item of items) {
    const key = item.group ?? "";
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else {
      byKey.set(key, [item]);
      order.push(key);
    }
  }
  const ungrouped = byKey.get("");
  const labelled = order.filter(key => key !== "");
  return [
    ...(ungrouped ? [{ value: "", items: ungrouped }] : []),
    ...labelled.map(key => ({ value: key, items: byKey.get(key) ?? [] })),
  ];
}

export const SearchSelect = defineComponent<
  SearchSelectOwnProps,
  typeof SEARCHSELECT_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "SearchSelect",
  selectors: SEARCHSELECT_SELECTORS,
  classes,
  vars: () => ({
    popup: { "--sb-searchselect-max-h": SEARCHSELECT_SCALARS.maxHeight },
    groupLabel: { "--sb-searchselect-tracking": SEARCHSELECT_SCALARS.tracking },
    item: {
      "--sb-searchselect-item-h": SEARCHSELECT_SCALARS.itemHeight,
      "--sb-searchselect-hover": SEARCHSELECT_SCALARS.hover,
    },
  }),
  render: ({ props, getStyles, ref }) => {
    const { items, value, onValueChange, label, searchPlaceholder, emptyText, footer } = props;
    const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
    const groups = useMemo(() => grouped(items), [items]);
    const selected = items.find(i => i.value === value) ?? null;
    return (
      <div ref={ref} {...getStyles("root")} data-part={SEARCHSELECT_PARTS.root}>
        <Combobox.Root
          items={groups}
          value={selected}
          onValueChange={(next: SearchSelectItem | null) => next && onValueChange(next.value)}
          isItemEqualToValue={(a: SearchSelectItem, b: SearchSelectItem) => a.value === b.value}
          itemToStringLabel={(i: SearchSelectItem) => i.label}
          autoHighlight
        >
          <Combobox.Label {...getStyles("label")}>{label}</Combobox.Label>
          <Combobox.Trigger {...getStyles("trigger")} data-part={SEARCHSELECT_PARTS.trigger} aria-label={label}>
            {selected?.icon}
            <span {...getStyles("value")}>
              <Combobox.Value />
            </span>
            <Combobox.Icon {...getStyles("chevron")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </Combobox.Icon>
          </Combobox.Trigger>
          {/* An in-place wrapper, not <body>, so a scoped theme around the caller still reaches the popup. */}
          <div ref={setWrapper} {...getStyles("portal")} />
          <Combobox.Portal container={wrapper}>
            <Combobox.Positioner align="start" sideOffset={4} {...getStyles("positioner")}>
              <Combobox.Popup {...getStyles("popup")} data-part={SEARCHSELECT_PARTS.popup} aria-label={label}>
                <Combobox.Input {...getStyles("search")} placeholder={searchPlaceholder} />
                <Combobox.Empty {...getStyles("empty")}>{emptyText ?? "Nothing matches"}</Combobox.Empty>
                <Combobox.List {...getStyles("list")}>
                  {(group: Group) => (
                    <Combobox.Group key={group.value} items={group.items}>
                      {group.value && <Combobox.GroupLabel {...getStyles("groupLabel")}>{group.value}</Combobox.GroupLabel>}
                      <Combobox.Collection>
                        {(item: SearchSelectItem) => (
                          <Combobox.Item key={item.value} value={item} {...getStyles("item")} data-part={SEARCHSELECT_PARTS.item}>
                            {item.icon && <span {...getStyles("itemIcon")}>{item.icon}</span>}
                            <span {...getStyles("itemLabel")}>{item.label}</span>
                            {item.detail && <span {...getStyles("itemDetail")}>{item.detail}</span>}
                          </Combobox.Item>
                        )}
                      </Combobox.Collection>
                    </Combobox.Group>
                  )}
                </Combobox.List>
                {footer && <div {...getStyles("footer")}>{footer}</div>}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
    );
  },
});

export type SearchSelectProps = ComponentProps<typeof SearchSelect>;

export const searchSelectTheme = SearchSelect.extend({});
