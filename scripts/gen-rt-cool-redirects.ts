import { mkdirSync, writeFileSync } from "fs";
import { rtCoolRedirects } from "./lib/docs-moves.ts";

mkdirSync("sites/docs/redirects/rt-cool", { recursive: true });
writeFileSync("sites/docs/redirects/rt-cool/_redirects", rtCoolRedirects());
console.log("wrote sites/docs/redirects/rt-cool/_redirects");
