/** Stands in for `node:crypto` in Storybook only. glance's root entry
    imports it for its GitHub client, which no story ever calls; the board's
    own Bun bundle tree-shakes that client away, but Vite's dev server loads
    the whole entry and the browser-external proxy throws on import. */
export function createHash(): never {
  throw new Error('node:crypto is not available in Storybook');
}
