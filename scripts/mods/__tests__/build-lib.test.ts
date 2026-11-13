import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildMod, findDynamicImport, inlineMatcherConstants, rewriteClientPaths } from '../build-lib'

const FIXTURE = resolve(import.meta.dir, '../../../packages/mod-kit/test/fixture-mod')
const made: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mod-build-'))
  made.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('rewriteClientPaths', () => {
  const bundled = 'h(Client, { module: "./form.tsx" }); h(Client, { module: "./band.tsx" })'

  test('points every listed client at its built file', () => {
    const out = rewriteClientPaths(bundled, ['form.tsx', 'band.tsx'])
    expect(out.source).toBe('h(Client, { module: "./form.js" }); h(Client, { module: "./band.js" })')
    expect(out.unknown).toEqual([])
  })

  test('reports a module that mod.json does not list', () => {
    const out = rewriteClientPaths(bundled, ['form.tsx'])
    expect(out.source).toContain('module: "./form.js"')
    expect(out.unknown).toEqual(['band.tsx'])
  })

  test('leaves other strings that merely look like paths alone', () => {
    const src = 'const a = "./form.tsx"; h(Client, { module: "./form.tsx", props: { note: "./other.tsx" } })'
    const out = rewriteClientPaths(src, ['form.tsx'])
    expect(out.source).toBe('const a = "./form.tsx"; h(Client, { module: "./form.js", props: { note: "./other.tsx" } })')
    expect(out.unknown).toEqual([])
  })
})

describe('findDynamicImport', () => {
  test('finds the first import(', () => {
    expect(findDynamicImport('const x = await import("./a")')).toBeTypeOf('number')
    expect(findDynamicImport('const x = await import("./a")')).toBe(16)
  })

  test('is undefined without one', () => {
    expect(findDynamicImport('const x = 1\nexport { x }')).toBeUndefined()
  })
})

describe('inlineMatcherConstants', () => {
  test('replaces a constant used as a matcher value with its literal', () => {
    const out = inlineMatcherConstants('var PANE = "gate-form";\non("ui.render", { component: "Pane", requestId: PANE }, f)')
    expect(out).toContain('requestId: "gate-form"')
    expect(out).toContain('var PANE = "gate-form";')
  })

  test('leaves identifiers outside a matcher alone', () => {
    const src = 'var PANE = "gate-form";\nopen({ id: PANE });\non("ui.render", { component: "Pane" }, () => PANE)'
    expect(inlineMatcherConstants(src)).toBe(src)
  })

  test('fails on a matcher value it cannot make a literal', () => {
    expect(() => inlineMatcherConstants('on("ui.render", { requestId: pane }, f)')).toThrow(/requestId/)
  })
})

describe('buildMod', () => {
  test('bundles the fixture into a plugin', async () => {
    const out = join(scratch(), 'fixture-mod')
    await buildMod(FIXTURE, out, { validate: false })

    expect(readdirSync(join(out, 'hooks')).sort()).toEqual(['band.js', 'fixture.test.tsx', 'form.js', 'helper.ts', 'hooks.json', 'register.js'])
    expect(JSON.parse(readFileSync(join(out, 'hooks/hooks.json'), 'utf8'))).toEqual({ modules: ['./register.js'] })
    expect(JSON.parse(readFileSync(join(out, '.claude-plugin/plugin.json'), 'utf8'))).toMatchObject({ name: 'fixture-mod', version: '0.0.1' })
    expect(readFileSync(join(out, '.gitignore'), 'utf8')).toContain('.claude-plugin/types/')

    const register = readFileSync(join(out, 'hooks/register.js'), 'utf8')
    expect(register).toContain('module: "./band.js"')
    expect(register).toContain('module: "./form.js"')
    expect(register).not.toMatch(/module: "[^"]*\.tsx"/)
    expect(register).toMatch(/function register\(on\)/)
    expect(register).toContain('requestId: "fixture-pane"')
    expect(findDynamicImport(register)).toBeUndefined()
  })

  test('empties the output folder first', async () => {
    const out = join(scratch(), 'fixture-mod')
    await buildMod(FIXTURE, out, { validate: false })
    writeFileSync(join(out, 'hooks/old.js'), 'stale')
    await buildMod(FIXTURE, out, { validate: false })
    expect(existsSync(join(out, 'hooks/old.js'))).toBe(false)
    expect(existsSync(join(out, 'hooks/register.js'))).toBe(true)
  })

  test('refuses to empty a folder that is not this plugin', async () => {
    const out = scratch()
    writeFileSync(join(out, 'precious.txt'), 'keep')
    await expect(buildMod(FIXTURE, out, { validate: false })).rejects.toThrow(/not a plugin output/)
    expect(readFileSync(join(out, 'precious.txt'), 'utf8')).toBe('keep')

    mkdirSync(join(out, '.claude-plugin'))
    writeFileSync(join(out, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'someone-else' }))
    await expect(buildMod(FIXTURE, out, { validate: false })).rejects.toThrow(/not a plugin output/)
    expect(existsSync(join(out, 'precious.txt'))).toBe(true)
  })

  test('refuses a folder holding the mod itself', async () => {
    const parent = scratch()
    mkdirSync(join(parent, '.claude-plugin'))
    writeFileSync(join(parent, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'fixture-mod' }))
    const src = join(parent, 'src-copy')
    cpSync(FIXTURE, src, { recursive: true })
    await expect(buildMod(src, parent, { validate: false })).rejects.toThrow(/holds the mod's source/)
    expect(existsSync(join(src, 'mod.json'))).toBe(true)
  })

  test('refuses an output folder inside the mod source', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    await expect(buildMod(src, join(src, 'out'), { validate: false })).rejects.toThrow(/inside the mod's source/)
    expect(existsSync(join(src, 'out'))).toBe(false)
    expect(existsSync(join(src, 'mod.json'))).toBe(true)
  })

  test('builds the same bytes from any working directory', async () => {
    const first = join(scratch(), 'a')
    const second = join(scratch(), 'b')
    const here = process.cwd()
    try {
      await buildMod(FIXTURE, first, { validate: false })
      process.chdir(scratch())
      await buildMod(FIXTURE, second, { validate: false })
    } finally {
      process.chdir(here)
    }
    const register = readFileSync(join(first, 'hooks/register.js'), 'utf8')
    expect(readFileSync(join(second, 'hooks/register.js'), 'utf8')).toBe(register)
    expect(register).toMatch(/^\/\/ packages\/mod-kit\/test\/fixture-mod\/src\/register\.tsx$/m)
    expect(register).not.toContain(tmpdir())
  })

  test('fails when the hooks entry names a Client that mod.json does not list', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(src, 'mod.json'), 'utf8'))
    writeFileSync(join(src, 'mod.json'), JSON.stringify({ ...manifest, clients: ['form.tsx'] }))
    await expect(buildMod(src, join(scratch(), 'out'), { validate: false })).rejects.toThrow(/band\.tsx/)
  })

  test('fails when a listed Client file is missing', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    rmSync(join(src, 'src/form.tsx'))
    await expect(buildMod(src, join(scratch(), 'out'), { validate: false })).rejects.toThrow(/form\.tsx/)
  })

  test('fails on a dynamic import in the built code', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    writeFileSync(join(src, 'src/kit/band-slot.tsx'), 'export const lazy = (path: string) => import(path)\nexport const bandSlot = () => null\n')
    writeFileSync(join(src, 'src/register.tsx'), 'import { lazy } from "./kit/band-slot"\nexport function register(on: unknown): void { void on; void lazy("x") }\n')
    await expect(buildMod(src, join(scratch(), 'out'), { validate: false })).rejects.toThrow(/import\(/)
  })

  test('copies the files entries to the plugin root', async () => {
    const out = join(scratch(), 'out')
    await buildMod(FIXTURE, out, { validate: false })
    expect(readFileSync(join(out, 'LICENSE'), 'utf8')).toBe('Fixture license.\n')
    expect(readFileSync(join(out, 'docs/note.md'), 'utf8')).toContain('carried')
    expect(existsSync(join(out, 'hooks/helper.ts'))).toBe(true)
  })

  test('rejects a files entry that leaves the mod folder', async () => {
    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'mod.json'), 'utf8'))
    for (const entry of ['../escape', '/etc/hosts']) {
      const src = join(scratch(), 'mod')
      cpSync(FIXTURE, src, { recursive: true })
      writeFileSync(join(src, 'mod.json'), JSON.stringify({ ...manifest, files: [entry] }))
      await expect(buildMod(src, join(scratch(), 'out'), { validate: false })).rejects.toThrow(/files entry/)
    }
  })

  test('rejects a files entry that does not exist', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(src, 'mod.json'), 'utf8'))
    writeFileSync(join(src, 'mod.json'), JSON.stringify({ ...manifest, files: ['MISSING.md'] }))
    await expect(buildMod(src, join(scratch(), 'out'), { validate: false })).rejects.toThrow(/MISSING\.md/)
  })

  test('copies types and assets beside the hooks', async () => {
    const src = join(scratch(), 'mod')
    cpSync(FIXTURE, src, { recursive: true })
    mkdirSync(join(src, 'types'))
    writeFileSync(join(src, 'types/index.d.ts'), 'export type A = 1\n')
    mkdirSync(join(src, 'assets'))
    writeFileSync(join(src, 'assets/a.txt'), 'a')
    const out = join(scratch(), 'out')
    await buildMod(src, out, { validate: false })
    expect(readFileSync(join(out, 'types/index.d.ts'), 'utf8')).toBe('export type A = 1\n')
    expect(readFileSync(join(out, 'assets/a.txt'), 'utf8')).toBe('a')
  })
})
