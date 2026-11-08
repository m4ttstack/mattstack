import type { PrismTheme } from "prism-react-renderer";

// One theme for both modes: every color is a CSS variable from tokens.css, so the
// server-built HTML already has the right colors before React swaps Prism themes.
const v = (name: string) => `var(--ms-syntax-${name})`;

export const prismTheme: PrismTheme = {
  plain: { color: v("fg"), backgroundColor: "var(--ms-surface)" },
  styles: [
    { types: ["comment", "prolog", "cdata"], style: { color: v("comment") } },
    { types: ["doctype", "entity"], style: { color: v("fg") } },
    { types: ["attr-name", "class-name", "maybe-class-name", "boolean", "constant", "number", "atrule"], style: { color: v("constant") } },
    { types: ["keyword"], style: { color: v("keyword") } },
    { types: ["property", "tag", "symbol", "deleted", "important"], style: { color: v("tag") } },
    { types: ["selector", "string", "char", "builtin", "inserted", "regex", "attr-value"], style: { color: v("string") } },
    { types: ["punctuation"], style: { color: v("punctuation") } },
    { types: ["variable", "operator", "function"], style: { color: v("function") } },
    { types: ["url"], style: { color: v("url") } },
    { types: ["deleted"], style: { textDecorationLine: "line-through" } },
    { types: ["inserted"], style: { textDecorationLine: "underline" } },
    { types: ["italic"], style: { fontStyle: "italic" } },
    { types: ["important", "bold"], style: { fontWeight: "bold" } },
    { types: ["important"], style: { color: v("fg") } },
  ],
};
