import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeDoc } from '../ops/index.js'
import { noopGit, noopSearch } from '../ports.js'
import type { Actor, AuditEntry, BrainConfig, BrainContext } from '../types.js'
import { createAuditPort } from './index.js'

const config = (brainRoot: string, overrides: Partial<BrainConfig> = {}): BrainConfig => ({
  brainRoot,
  gitAutocommit: false,
  gitAuthorSuffix: '@g-brain.local',
  gitDebounceMs: 20,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 262_144,
  rateLimitPerMinute: 10_000,
  auditMaxBytes: 8_388_608,
  auditKeep: 3,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 90,
  ...overrides,
})

const actor: Actor = {
  id: 'capture-agent',
  name: 'capture-agent',
  scopes: [{ folder: '', read: true, write: true }],
}

let root: string

const contextWith = (overrides: Partial<BrainConfig> = {}): BrainContext => {
  const settings = config(root, overrides)
  return {
    root,
    config: settings,
    actor,
    git: noopGit,
    audit: createAuditPort(root, settings),
    search: noopSearch,
  }
}

const auditLines = async (): Promise<Array<Record<string, unknown>>> => {
  const contents = await readFile(join(root, '.brain', 'audit.jsonl'), 'utf8')
  return contents
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-audit-'))
  await writeFile(
    join(root, 'content-structure.md'),
    '# Structure\n\n## 10-knowledge/\n\nDurable reference.\n',
    'utf8',
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the audit log', () => {
  it('records a successful write with its etag', async () => {
    const context = contextWith()
    await writeDoc(context, {
      path: '10-knowledge/a.md',
      content: '---\ntitle: A\ntype: note\n---\n\nText.\n',
    })

    const [entry] = await auditLines()
    expect(entry?.action).toBe('write')
    expect(entry?.outcome).toBe('ok')
    expect(entry?.actor).toBe('capture-agent')
    expect(entry?.etag).toBeTruthy()
  })

  it('flags a write to a folder the convention does not describe', async () => {
    const context = contextWith()
    await writeDoc(context, {
      path: '77-experiments/spike.md',
      content: '---\ntitle: Spike\n---\n\nTrying it.\n',
    })

    const [entry] = await auditLines()
    expect(entry?.outcome).toBe('ok')
    expect(entry?.drift).toBe(true)
  })

  it('records a refused credential — this line is its only trace', async () => {
    // A rejection produces no commit, so without the audit log there would be
    // no record that an agent tried to put a credential in a shared brain.
    const context = contextWith()
    await writeDoc(context, {
      path: '00-inbox/creds.md',
      content: '---\ntitle: Creds\n---\n\ntoken = ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    })

    const [entry] = await auditLines()
    expect(entry?.outcome).toBe('rejected')
    expect(entry?.errorCode).toBe('UNSAFE_CONTENT')
    expect(entry?.finding).toBeTruthy()
  })

  it('never writes the secret itself, only the rule that matched', async () => {
    const context = contextWith()
    const secret = 'ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    await writeDoc(context, {
      path: '00-inbox/creds.md',
      content: `---\ntitle: Creds\n---\n\ntoken = ${secret}\n`,
    })

    const raw = await readFile(join(root, '.brain', 'audit.jsonl'), 'utf8')
    expect(raw).not.toContain(secret)
  })

  it('reads back the most recent entries', async () => {
    const context = contextWith()
    for (const name of ['a', 'b', 'c']) {
      await writeDoc(context, {
        path: `10-knowledge/${name}.md`,
        content: `---\ntitle: ${name}\n---\n\nBody ${name}.\n`,
      })
    }

    const recent = await context.audit.tail(2)
    expect(recent).toHaveLength(2)
    expect(recent[1]?.path).toBe('10-knowledge/c.md')
  })

  it('rotates by renaming, so nothing is lost at the moment it rotates', async () => {
    const context = contextWith({ auditMaxBytes: 300 })

    for (let i = 0; i < 12; i++) {
      await writeDoc(context, {
        path: `10-knowledge/doc-${i}.md`,
        content: `---\ntitle: Doc ${i}\n---\n\nUnique body number ${i} with enough text to differ.\n`,
      })
    }

    const files = (await readdir(join(root, '.brain'))).filter((f) => f.endsWith('.jsonl'))
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain('audit.jsonl')
    // Rotation prunes to auditKeep rotated files, plus the live one.
    expect(files.length).toBeLessThanOrEqual(context.config.auditKeep + 1)
  })
})
