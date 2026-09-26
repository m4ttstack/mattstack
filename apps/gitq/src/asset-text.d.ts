// Text imports (`with { type: "text" }`) used by src/server/server.ts and
// src/compiled.ts; Bun loads them as strings and embeds them in compiled
// binaries.
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.svg' {
  const text: string;
  export default text;
}
declare module '*.txt' {
  const text: string;
  export default text;
}
