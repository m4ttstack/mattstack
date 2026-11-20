/**
 * The Scalar viewer bundle, embedded as text. Only `/docs/scalar.js` loads
 * this module, so the daemon carries the ~4.6 MB string only once someone
 * opens the docs.
 */

// Relative because the package's `exports` omit this file, so Bun refuses the bare specifier.
import scalarJs from "../../node_modules/@scalar/api-reference/dist/browser/standalone.js" with { type: "text" };

export const SCALAR_JS: string = scalarJs;
