import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { childEnv } from '../../lib/subprocess'

export type ModManifest = {
  plugin: Record<string, unknown> & { name: string; version: string }
  clients: string[]
}

const CLIENT_MODULE = /\bmodule:\s*"\.\/([^"]+\.tsx)"/g

// Claude Code writes these into the plugin folder when it loads the hooks module.
const GITIGNORE = `# Written by Claude Code when it loads the hooks module from this folder
tsconfig.json
.claude-plugin/types/
`

export function rewriteClientPaths(source: string, clients: string[]): { source: string; unknown: string[] } {
  const unknown: string[] = []
  const rewritten = source.replace(CLIENT_MODULE, (whole, file: string) => {
    if (!clients.includes(file)) {
      if (!unknown.includes(file)) unknown.push(file)
      return whole
    }
    return whole.replace(`./${file}"`, `./${file.slice(0, -'.tsx'.length)}.js"`)
  })
  return { source: rewritten, unknown }
}

const REPO_ROOT = resolve(import.meta.dir, '../..')
const SOURCE_MARKER = /^\/\/ (.+)$/gm

// Bun writes each module's `// path` marker relative to the cwd; rebasing onto the repo root keeps a committed build the same from any directory.
export function rebaseSourceMarkers(text: string, cwd: string = process.cwd()): string {
  return text.replace(SOURCE_MARKER, (whole, path: string) => {
    const file = resolve(cwd, path)
    return existsSync(file) && statSync(file).isFile() ? `// ${relative(REPO_ROOT, file)}` : whole
  })
}

export function findDynamicImport(source: string): number | undefined {
  const at = source.search(/(?<![\w$.])import\s*\(/)
  return at === -1 ? undefined : at
}

// Index just past the string or comment that starts at `i`, or `i` when none does.
function skipLiteral(source: string, i: number): number {
  const c = source[i]
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1
    while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1
    return j + 1
  }
  if (c === '/' && source[i + 1] === '/') {
    const end = source.indexOf('\n', i)
    return end === -1 ? source.length : end
  }
  if (c === '/' && source[i + 1] === '*') {
    const end = source.indexOf('*/', i + 2)
    return end === -1 ? source.length : end + 2
  }
  return i
}

const STRING_CONSTANT = /^(?:var|const|let)\s+([\w$]+)\s*=\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*');?[ \t]*$/gm
const MATCHER_CALL = /(?<![\w$.])on\(\s*(?:"[^"]*"|'[^']*')\s*,\s*\{/g
const KEYWORD = new Set(['true', 'false', 'null', 'undefined'])

// Claude Code reads a matcher's value off the source and shows anything but a literal as `?`; Bun turns a top-level const into a `var`, so the bundle holds `requestId: PANE`.
export function inlineMatcherConstants(source: string): string {
  const constants = new Map<string, string>()
  for (const m of source.matchAll(STRING_CONSTANT)) constants.set(m[1]!, m[2]!)

  const edits: { from: number; to: number; text: string }[] = []
  for (const call of source.matchAll(MATCHER_CALL)) {
    const open = call.index + call[0].length - 1
    let depth = 1
    let key = ''
    for (let i = open + 1; i < source.length && depth > 0; ) {
      const skipped = skipLiteral(source, i)
      if (skipped !== i) {
        i = skipped
        continue
      }
      const c = source[i]!
      if ('{[('.includes(c)) depth++
      else if ('}])'.includes(c)) depth--
      else if (depth === 1 && c === ',') key = ''
      else if (depth === 1 && c !== ':' && /[\w$]/.test(c) && key === '') key = source.slice(i).match(/^[\w$]+/)![0]
      if (depth === 1 && c === ':') {
        const value = /\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/y
        value.lastIndex = i + 1
        const found = value.exec(source)
        const name = found?.[1]
        if (found && name && !KEYWORD.has(name)) {
          const literal = constants.get(name)
          if (literal === undefined) throw new Error(`the matcher key "${key}" is the identifier ${name}, which is not a top-level string constant, so Claude Code cannot read it`)
          const from = i + 1 + found[0].indexOf(name)
          edits.push({ from, to: from + name.length, text: literal })
        }
      }
      i++
    }
  }

  let out = source
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to)
  return out
}

function readManifest(srcDir: string): ModManifest {
  const file = join(srcDir, 'mod.json')
  if (!existsSync(file)) throw new Error(`no mod.json in ${srcDir}`)
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Partial<ModManifest>
  const { plugin, clients } = manifest
  if (!plugin || typeof plugin.name !== 'string' || typeof plugin.version !== 'string') throw new Error(`${file}: plugin needs a name and a version`)
  if (!Array.isArray(clients) || clients.some(c => typeof c !== 'string' || !c.endsWith('.tsx'))) throw new Error(`${file}: clients must list .tsx files`)
  for (const c of clients) if (!existsSync(join(srcDir, 'src', c))) throw new Error(`${file}: client ${c} is not in src/`)
  return { plugin, clients }
}

// An output folder is emptied only when it is new, empty, or already this plugin's own output: a wrong path must not cost anything.
function assertEmptiable(srcDir: string, outDir: string, name: string): void {
  const out = resolve(outDir)
  const src = resolve(srcDir)
  if (src === out || src.startsWith(out + sep)) throw new Error(`refusing to empty ${out}: it holds the mod's source`)
  if (out.startsWith(src + sep)) throw new Error(`refusing to build into ${out}: it is inside the mod's source`)
  if (!existsSync(out) || readdirSync(out).length === 0) return
  const manifest = join(out, '.claude-plugin/plugin.json')
  let owner: unknown
  try {
    owner = JSON.parse(readFileSync(manifest, 'utf8')).name
  } catch {
    owner = undefined
  }
  if (owner !== name) throw new Error(`refusing to empty ${out}: it is not a plugin output of ${name}`)
}

export async function buildMod(srcDir: string, outDir: string, opts: { validate: boolean }): Promise<void> {
  const { plugin, clients } = readManifest(srcDir)
  assertEmptiable(srcDir, outDir, plugin.name)

  const root = join(srcDir, 'src')
  const hooksEntry = join(root, 'register.tsx')
  if (!existsSync(hooksEntry)) throw new Error(`no src/register.tsx in ${srcDir}`)

  const result = await Bun.build({
    entrypoints: [hooksEntry, ...clients.map(c => join(root, c))],
    root,
    format: 'esm',
    target: 'browser',
    splitting: false,
    minify: false,
    external: ['claude-code'],
    jsx: { runtime: 'classic', factory: 'h', fragment: 'Fragment' },
    throw: false,
  })
  if (!result.success) throw new Error(`bundling ${plugin.name} failed:\n${result.logs.map(String).join('\n')}`)

  const files = new Map<string, string>()
  for (const output of result.outputs) {
    if (output.kind !== 'entry-point') continue
    let text = rebaseSourceMarkers(await output.text())
    const name = output.path.replace(/^\.\//, '')
    const dynamic = findDynamicImport(text)
    if (dynamic !== undefined) throw new Error(`${name} has a dynamic import( at offset ${dynamic}; a mod's modules are bundled into one file each`)
    if (name === 'register.js') {
      const rewritten = rewriteClientPaths(text, clients)
      if (rewritten.unknown.length > 0) throw new Error(`register.js draws Client modules that mod.json does not list in clients: ${rewritten.unknown.join(', ')}`)
      text = inlineMatcherConstants(rewritten.source)
    }
    files.set(name, text)
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'hooks'), { recursive: true })
  mkdirSync(join(outDir, '.claude-plugin'), { recursive: true })
  for (const [name, text] of files) {
    mkdirSync(dirname(join(outDir, 'hooks', name)), { recursive: true })
    writeFileSync(join(outDir, 'hooks', name), text)
  }
  writeFileSync(join(outDir, 'hooks/hooks.json'), `${JSON.stringify({ modules: ['./register.js'] })}\n`)
  writeFileSync(join(outDir, '.claude-plugin/plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`)
  writeFileSync(join(outDir, '.gitignore'), GITIGNORE)

  for (const dir of ['types', 'assets']) if (existsSync(join(srcDir, dir))) cpSync(join(srcDir, dir), join(outDir, dir), { recursive: true })
  const harness = join(srcDir, 'harness')
  if (existsSync(harness)) {
    for (const file of readdirSync(harness)) if (file.endsWith('.test.tsx')) cpSync(join(harness, file), join(outDir, 'hooks', file))
  }

  if (opts.validate) await validatePlugin(outDir)
}

async function validatePlugin(outDir: string): Promise<void> {
  const proc = Bun.spawn(['claude', 'plugin', 'validate', outDir], { env: childEnv(), stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`claude plugin validate ${outDir} exited ${code}:\n${stdout}${stderr}`)
}

export function treeSignature(dirs: string[]): string {
  const rows: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stat = statSync(path)
        rows.push(`${path}:${stat.size}:${stat.mtimeMs}`)
      }
    }
  }
  for (const dir of dirs) if (existsSync(dir)) walk(dir)
  return rows.sort().join('\n')
}
