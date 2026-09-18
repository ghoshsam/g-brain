import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

const readPkg = (dir: string) =>
  JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

/** Reaching the filesystem, git, or the index from a surface. */
const FORBIDDEN_IN_APPS = ['simple-git', 'gray-matter', '@orama/orama', 'chokidar', 'fast-glob']

const walk = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('apps are thin', () => {
  for (const app of ['apps/mcp', 'apps/cli']) {
    it(`${app} declares no storage, git, or search dependency`, () => {
      const pkg = readPkg(app)
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      for (const forbidden of FORBIDDEN_IN_APPS) {
        expect(deps, `${app} must reach the filesystem through @g-brain/core`).not.toContain(
          forbidden,
        )
      }
    })

    it(`${app} does not import node:fs`, () => {
      for (const file of walk(join(ROOT, app, 'src'))) {
        // Tests build a temp brain to run against, which is the point of them.
        // The rule is about what the shipped surface can reach.
        if (file.endsWith('.test.ts')) continue

        const source = readFileSync(file, 'utf8')
        expect(source, `${file} must reach the filesystem through @g-brain/core`).not.toMatch(
          /from ['"]node:fs/,
        )
      }
    })
  }
})

describe('dependencies point one way', () => {
  it('no core module imports ops', () => {
    const coreSrc = join(ROOT, 'packages/core/src')
    // ops itself, and the package barrel that re-exports it as the public API.
    const allowed = [join('src', 'ops'), join('src', 'index.ts')]

    for (const file of walk(coreSrc)) {
      // Tests compose modules end to end, which is what makes them worth
      // having. The rule is about the shape of the shipped dependency graph.
      if (file.endsWith('.test.ts')) continue
      if (allowed.some((a) => file.includes(a))) continue
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} must not import ops — dependencies point one way`).not.toMatch(
        /from ['"]\.{1,2}\/ops/,
      )
    }
  })

  it('search depends on core for types, and nothing else in the workspace', () => {
    // One direction only: search imports core's types; core never imports
    // search. That is what keeps search replaceable.
    const pkg = readPkg('packages/search')
    const deps = Object.keys({ ...pkg.dependencies })
    expect(deps.filter((d) => d.startsWith('@g-brain/'))).toEqual(['@g-brain/core'])
  })

  it('core does not import search', () => {
    const pkg = readPkg('packages/core')
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps).not.toContain('@g-brain/search')
  })
})
