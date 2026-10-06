import { mkdirSync, writeFileSync } from "fs";
import { rtCoolRedirects } from "./lib/docs-moves.ts";

mkdirSync("website/redirects/rt-cool", { recursive: true });
writeFileSync("website/redirects/rt-cool/_redirects", rtCoolRedirects());
console.log("wrote website/redirects/rt-cool/_redirects");
