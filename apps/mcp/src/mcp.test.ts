import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureBrainExists, err, noopAudit, noopGit, noopSearch, ok } from '@g-brain/core'
import type { Actor, BrainConfig, BrainContext } from '@g-brain/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { errorCodeOf, textOf, toToolResult } from './server.js'
import { TOOLS } from './tools.js'

const toolNamed = (name: string) => {
  const tool = TOOLS.find((t) => t.name === name)
  if (tool === undefined) throw new Error(`no tool called ${name}`)
  return tool
}

const config = (brainRoot: string): BrainConfig => ({
  brainRoot,
  gitAutocommit: false,
  gitAuthorSuffix: '@g-brain.local',
  gitDebounceMs: 2000,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 262_144,
  rateLimitPerMinute: 120,
  auditMaxBytes: 8_388_608,
  auditKeep: 8,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 90,
})

const localActor: Actor = {
  id: 'local',
  name: 'local',
  scopes: [{ folder: '', read: true, write: true }],
}

let brainRoot: string
let context: BrainContext

beforeEach(async () => {
  brainRoot = await mkdtemp(join(tmpdir(), 'gbrain-mcp-'))
  context = {
    root: brainRoot,
    config: config(brainRoot),
    actor: localActor,
    git: noopGit,
    audit: noopAudit,
    search: noopSearch,
  }
})

afterEach(async () => {
  await rm(brainRoot, { recursive: true, force: true })
})

describe('the surface is a mapping, nothing more', () => {
  it('turns a success into text content', () => {
    const mapped = toToolResult(ok({ etag: 'abc' }))

    expect(mapped.isError).toBeUndefined()
    expect(textOf(mapped)).toContain('abc')
  })

  it('carries the error code so an agent can branch on it', () => {
    const mapped = toToolResult(
      err('CONFLICT', 'a near-duplicate exists', { existingPath: 'x.md' }),
    )

    expect(mapped.isError).toBe(true)
    expect(errorCodeOf(mapped)).toBe('CONFLICT')
    expect(textOf(mapped)).toContain('existingPath')
  })

  it('maps every error code without losing it', () => {
    const codes = [
      'NOT_FOUND',
      'INVALID_PATH',
      'PRECONDITION_REQUIRED',
      'PRECONDITION_FAILED',
      'CONFLICT',
      'UNSAFE_CONTENT',
      'TOO_LARGE',
      'RATE_LIMITED',
      'UNAUTHORIZED',
      'FORBIDDEN',
    ] as const

    for (const code of codes) {
      expect(errorCodeOf(toToolResult(err(code, 'x')))).toBe(code)
    }
  })
})

describe('tool descriptions are shipped product copy', () => {
  it('registers the tools the reference names', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'brain_append',
      'brain_delete',
      'brain_history',
      'brain_links',
      'brain_list',
      'brain_read',
      'brain_search',
      'brain_structure',
      'brain_tree',
      'brain_write',
    ])
  })

  it('tells the agent when to reach for the brain, not only how', () => {
    // FR-30: this is what makes capture happen in a client with no skill
    // support, so it is asserted rather than assumed.
    const structure = toolNamed('brain_structure').description
    expect(structure).toContain('before your first write')

    const write = toolNamed('brain_write').description
    expect(write).toContain('Search before you create')
    expect(write).toContain('00-inbox/')
    expect(write).toContain('correct answer, not a failure')
    expect(write).toContain('recorded as drift')
    expect(write).toContain('never force')

    const append = toolNamed('brain_append').description
    expect(append).toContain('Prefer this over')
    expect(append).toContain('cannot clobber')
  })

  it('warns against secrets on every tool that writes', () => {
    for (const name of ['brain_write', 'brain_append']) {
      expect(toolNamed(name).description).toContain('Never write secrets')
    }
  })
})

describe('tools run against core', () => {
  beforeEach(async () => {
    await writeFile(
      join(brainRoot, 'content-structure.md'),
      '# Content Structure\n\n## 00-inbox/\n\nUnplaced captures.\n\n## 10-knowledge/{topic}/\n\nDurable reference.\n',
      'utf8',
    )
  })

  it('brain_structure returns the convention verbatim', async () => {
    const result = await toolNamed('brain_structure').run(context, {})

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value as { markdown: string; structureMissing: boolean }
    expect(value.structureMissing).toBe(false)
    expect(value.markdown).toContain('## 10-knowledge/{topic}/')
  })

  it('round-trips a write and a read', async () => {
    const written = await toolNamed('brain_write').run(context, {
      path: '10-knowledge/auth/tokens.md',
      content: '---\ntitle: Tokens\ntype: how-to\ntags: [auth]\n---\n\nHow tokens refresh.\n',
    })
    expect(written.ok).toBe(true)

    const read = await toolNamed('brain_read').run(context, {
      path: '10-knowledge/auth/tokens.md',
    })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect((read.value as { meta: { title?: string } }).meta.title).toBe('Tokens')
  })

  it('surfaces a refused credential as a tool error carrying the code', async () => {
    const result = await toolNamed('brain_write').run(context, {
      path: '00-inbox/creds.md',
      content: '---\ntitle: Creds\n---\n\ntoken = ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    })

    expect(errorCodeOf(toToolResult(result))).toBe('UNSAFE_CONTENT')
  })
})

describe('zero-config first run', () => {
  it('creates a usable brain when there is none', async () => {
    const fresh = join(brainRoot, 'brand-new')

    const created = await ensureBrainExists(fresh)
    expect(created).toBe(true)

    const structure = await readFile(join(fresh, 'content-structure.md'), 'utf8')
    expect(structure).toContain('00-inbox/')

    // The tree is real on the very first call, not empty.
    const freshContext = { ...context, root: fresh, config: config(fresh) }
    const result = await toolNamed('brain_structure').run(freshContext, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.value as { structureMissing: boolean }).structureMissing).toBe(false)
    expect((result.value as { tree: unknown[] }).tree.length).toBeGreaterThan(0)
  })

  it('leaves an existing brain alone', async () => {
    await writeFile(join(brainRoot, 'content-structure.md'), '# Mine\n\n## notes/\n', 'utf8')

    const created = await ensureBrainExists(brainRoot)
    expect(created).toBe(false)

    // Critically, it did not overwrite the convention someone had tailored.
    const structure = await readFile(join(brainRoot, 'content-structure.md'), 'utf8')
    expect(structure).toBe('# Mine\n\n## notes/\n')
  })
})
