import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const kit = join(import.meta.dir, '..', '..', 'packages', 'mod-kit')
const readme = readFileSync(join(kit, 'README.md'), 'utf8')
const indexSource = readFileSync(join(kit, 'src', 'index.ts'), 'utf8')
const exported = await import(join(kit, 'src', 'index.ts'))
const typeExports = new Set<string>()
for (const m of indexSource.matchAll(/export type \{([^}]*)\}/g)) {
  for (const n of m[1]!.split(',')) typeExports.add(n.trim())
}
const known = (name: string) => name in exported || typeExports.has(name)

// Names the README claims are kit exports: section headings, `<Component` tags and `name(` calls in inline code.
const claimed = new Set<string>()
for (const m of readme.matchAll(/^### (.+)$/gm)) {
  for (const n of m[1]!.matchAll(/`([A-Za-z_]\w*)`/g)) claimed.add(n[1]!)
}
for (const m of readme.matchAll(/`([^`\n]+)`/g)) {
  for (const n of m[1]!.matchAll(/<([A-Z]\w*)\b/g)) claimed.add(n[1]!)
  const call = m[1]!.match(/^([A-Za-z_]\w*)\(/)
  if (call) claimed.add(call[1]!)
}

// Documented in the README but owned by Claude Code or by an option object, not exports of the kit.
const NOT_KIT = new Set(['on', 'atom', 'import', 'initial', 'focused', 'isActive', 'engaged', 'toLines', 'bind', 'summary', 'withoutContext'])
const missing = [...claimed].filter(n => !known(n) && !NOT_KIT.has(n))
const mentioned = (n: string) => readme.includes(`\`${n}`) || readme.includes(`<${n}`)
const unmentioned = [...Object.keys(exported), ...typeExports].filter(n => !mentioned(n))
console.log(`checked ${claimed.size} names`)
if (unmentioned.length) console.log(`exports the README never names: ${unmentioned.join(', ')}`)
if (missing.length) {
  console.error(`README names not exported by src/index.ts: ${missing.join(', ')}`)
  process.exit(1)
}
