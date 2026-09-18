import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noopAudit, noopGit, noopSearch } from '../ports.js'
import type { BrainConfig, BrainContext } from '../types.js'
import { runDoctor } from './index.js'

const STRUCTURE = `# Content Structure

## 00-inbox/

Unplaced captures.

## 10-knowledge/{topic}/

Durable reference.

## 90-archive/

Finished content.
`

let root: string
let context: BrainContext

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

const write = async (path: string, content: string) => {
  const full = join(root, ...path.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-doctor-'))
  await writeFile(join(root, 'content-structure.md'), STRUCTURE, 'utf8')
  context = {
    root,
    config: config(root),
    actor: { id: 'local', name: 'local', scopes: [{ folder: '', read: true, write: true }] },
    git: noopGit,
    audit: noopAudit,
    search: noopSearch,
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runDoctor', () => {
  it('reports nothing for a brain with nothing wrong', async () => {
    await write(
      '10-knowledge/auth/a.md',
      '---\ntitle: A\ntype: note\n---\n\nSee [[10-knowledge/auth/b.md]].\n',
    )
    await write(
      '10-knowledge/auth/b.md',
      '---\ntitle: B\ntype: note\n---\n\nBack to [[10-knowledge/auth/a.md]].\n',
    )

    const result = await runDoctor(context)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.drift).toEqual([])
    expect(result.value.brokenLinks).toEqual([])
    expect(result.value.orphans).toEqual([])
    expect(result.value.lint).toEqual([])
    expect(result.value.documentCount).toBe(2)
  })

  it('finds a document in a folder the convention does not describe', async () => {
    await write('77-experiments/spike.md', '---\ntitle: Spike\ntype: note\n---\n\nTrying it.\n')

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.drift.map((d) => d.path)).toContain('77-experiments/spike.md')
  })

  it('finds a link pointing at nothing', async () => {
    await write(
      '10-knowledge/auth/a.md',
      '---\ntitle: A\n---\n\nSee [[10-knowledge/auth/gone.md]].\n',
    )

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.brokenLinks).toEqual([
      { from: '10-knowledge/auth/a.md', to: '10-knowledge/auth/gone.md' },
    ])
  })

  it('finds a document nothing links to that links to nothing', async () => {
    await write('10-knowledge/auth/alone.md', '---\ntitle: Alone\n---\n\nNo links here.\n')

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.orphans).toEqual(['10-knowledge/auth/alone.md'])
  })

  it('reports the inbox with the reason the agent left', async () => {
    await write(
      '00-inbox/unplaced.md',
      '---\ntitle: Unplaced\nneeds-filing: true\n---\n\nCould be a decision or a project note.\n',
    )

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.inbox[0]?.path).toBe('00-inbox/unplaced.md')
    expect(result.value.inbox[0]?.reason).toContain('decision or a project note')
  })

  it('finds content past its expires date', async () => {
    await write(
      '10-knowledge/auth/stale.md',
      '---\ntitle: Stale\nexpires: 2020-01-01\n---\n\nOld.\n',
    )

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.expired).toEqual([
      { path: '10-knowledge/auth/stale.md', expires: '2020-01-01' },
    ])
  })

  it('finds near-duplicates in the same folder', async () => {
    const body =
      'Access tokens are refreshed by the gateway every fifteen minutes using the rotating refresh token.\n'
    await write('10-knowledge/auth/one.md', `---\ntitle: One\n---\n\n${body}`)
    await write('10-knowledge/auth/two.md', `---\ntitle: Two\n---\n\n${body}`)

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.duplicates).toHaveLength(1)
    expect(result.value.duplicates[0]?.similarity).toBeGreaterThan(0.9)
  })

  it('changes nothing', async () => {
    await write('00-inbox/a.md', '---\ntitle: A\n---\n\nText.\n')
    await write('77-experiments/b.md', '---\n---\n\nMore.\n')

    const { readdir, readFile } = await import('node:fs/promises')
    const before = await readFile(join(root, '00-inbox', 'a.md'), 'utf8')
    const foldersBefore = (await readdir(root)).sort()

    await runDoctor(context)

    expect(await readFile(join(root, '00-inbox', 'a.md'), 'utf8')).toBe(before)
    expect((await readdir(root)).sort()).toEqual(foldersBefore)
  })

  it('ignores the convention and the README that init writes', async () => {
    await writeFile(join(root, 'README.md'), '# Brain\n\nScaffolding, not a capture.\n', 'utf8')

    const result = await runDoctor(context)
    if (!result.ok) return
    expect(result.value.documentCount).toBe(0)
    expect(result.value.drift).toEqual([])
  })
})
