import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noopAudit, noopGit, noopSearch } from '../ports.js'
import type { BrainConfig, BrainContext, DocPath } from '../types.js'
import { appendRaw, exists, readRaw, removeDoc, withLock, writeRaw } from './index.js'

const config: BrainConfig = {
  brainRoot: '',
  gitAutocommit: false,
  gitAuthorSuffix: '',
  gitDebounceMs: 0,
  mcpTransport: 'stdio',
  mcpHttpPort: 0,
  authRequired: false,
  maxDocBytes: 1_000_000,
  rateLimitPerMinute: 60,
  auditMaxBytes: 1_000_000,
  auditKeep: 3,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 30,
}

const p = (s: string): DocPath => s as DocPath
const DOC = p('20-projects/billing/open-questions.md')

let root: string
let ctx: BrainContext

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'gbrain-store-'))
  ctx = {
    root,
    config: { ...config, brainRoot: root },
    actor: { id: 'local', name: 'local', scopes: [{ folder: '', read: true, write: true }] },
    git: noopGit,
    audit: noopAudit,
    search: noopSearch,
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 })
})

function absOf(path: DocPath): string {
  return join(root, ...path.split('/'))
}

async function tempFilesIn(path: DocPath): Promise<string[]> {
  const entries = await fs.readdir(join(root, ...path.split('/').slice(0, -1)))
  return entries.filter((e) => e.endsWith('.tmp'))
}

function lockDirFor(path: DocPath): string {
  const hash = createHash('sha256').update(Buffer.from(path, 'utf8')).digest('hex')
  return join(root, '.brain', 'locks', `${hash}.lock`)
}

describe('writeRaw preconditions', () => {
  it('creates at a new path with no ifMatch', async () => {
    const r = await writeRaw(ctx, DOC, '# Open questions\n', {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.created).toBe(true)
    expect(r.value.path).toBe(DOC)
    expect(r.value.etag).toMatch(/^sha256:[0-9a-f]{64}$/)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('# Open questions\n')
  })

  it('refuses to replace without ifMatch', async () => {
    await writeRaw(ctx, DOC, 'first\n', {})
    const r = await writeRaw(ctx, DOC, 'second\n', {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PRECONDITION_REQUIRED')
    expect(r.error.message).toContain('ifMatch')
    // A caller that never read the document is not handed an etag.
    expect(r.error.details?.etag).toBeUndefined()
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('first\n')
  })

  it('fails a stale ifMatch and returns the current etag', async () => {
    const created = await writeRaw(ctx, DOC, 'first\n', {})
    expect(created.ok).toBe(true)
    const current = await readRaw(ctx, DOC)
    expect(current.ok).toBe(true)
    if (!current.ok) return

    const r = await writeRaw(ctx, DOC, 'second\n', { ifMatch: 'sha256:deadbeef' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PRECONDITION_FAILED')
    expect(r.error.details?.etag).toBe(current.value.etag)
    expect(r.error.details?.currentEtag).toBe(current.value.etag)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('first\n')
  })

  it('replaces with the correct ifMatch and returns a different etag', async () => {
    const created = await writeRaw(ctx, DOC, 'first\n', {})
    if (!created.ok) throw new Error('setup failed')

    const r = await writeRaw(ctx, DOC, 'second\n', { ifMatch: created.value.etag })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.created).toBe(false)
    expect(r.value.etag).not.toBe(created.value.etag)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('second\n')
  })

  it('fails an ifMatch on a path that holds no document', async () => {
    const r = await writeRaw(ctx, DOC, 'body\n', { ifMatch: 'sha256:deadbeef' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PRECONDITION_FAILED')
    expect(r.error.details?.currentEtag).toBeNull()
    expect(await exists(ctx, DOC)).toBe(false)
  })

  it('accepts a quoted ifMatch', async () => {
    const created = await writeRaw(ctx, DOC, 'first\n', {})
    if (!created.ok) throw new Error('setup failed')
    const r = await writeRaw(ctx, DOC, 'second\n', { ifMatch: `"${created.value.etag}"` })
    expect(r.ok).toBe(true)
  })

  it('ignores force — no flag bypasses a precondition', async () => {
    await writeRaw(ctx, DOC, 'first\n', {})
    const r = await writeRaw(ctx, DOC, 'second\n', { force: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PRECONDITION_REQUIRED')
  })
})

describe('the two-writer trace', () => {
  it('serialises A and B, loses no content, and lets B recover', async () => {
    const seed = await writeRaw(ctx, DOC, '# Questions\n\n- one\n', {})
    if (!seed.ok) throw new Error('setup failed')

    const readA = await readRaw(ctx, DOC)
    const readB = await readRaw(ctx, DOC)
    if (!readA.ok || !readB.ok) throw new Error('setup failed')
    expect(readA.value.etag).toBe(readB.value.etag)
    const e1 = readA.value.etag

    const a = await writeRaw(ctx, DOC, `${readA.value.content}- from A\n`, { ifMatch: e1 })
    expect(a.ok).toBe(true)
    if (!a.ok) return
    const e2 = a.value.etag
    expect(e2).not.toBe(e1)

    const bStale = await writeRaw(ctx, DOC, `${readB.value.content}- from B\n`, { ifMatch: e1 })
    expect(bStale.ok).toBe(false)
    if (bStale.ok) return
    expect(bStale.error.code).toBe('PRECONDITION_FAILED')
    expect(bStale.error.details?.etag).toBe(e2)

    const reread = await readRaw(ctx, DOC)
    if (!reread.ok) throw new Error('re-read failed')
    expect(reread.value.etag).toBe(e2)
    expect(reread.value.content).toContain('- from A')

    const bRetry = await writeRaw(ctx, DOC, `${reread.value.content}- from B\n`, { ifMatch: e2 })
    expect(bRetry.ok).toBe(true)

    const final = await fs.readFile(absOf(DOC), 'utf8')
    expect(final).toContain('- one')
    expect(final).toContain('- from A')
    expect(final).toContain('- from B')
  })

  it('treats an external edit exactly like another writer', async () => {
    const created = await writeRaw(ctx, DOC, 'first\n', {})
    if (!created.ok) throw new Error('setup failed')

    await fs.writeFile(absOf(DOC), 'edited in VS Code\n', 'utf8')

    const after = await readRaw(ctx, DOC)
    if (!after.ok) throw new Error('read failed')
    expect(after.value.etag).not.toBe(created.value.etag)

    const r = await writeRaw(ctx, DOC, 'agent body\n', { ifMatch: created.value.etag })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PRECONDITION_FAILED')
    expect(r.error.details?.etag).toBe(after.value.etag)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('edited in VS Code\n')
  })
})

describe('etags', () => {
  it('are stable for identical content and differ for different content', async () => {
    const other = p('20-projects/billing/same.md')
    const a = await writeRaw(ctx, DOC, 'identical\n', {})
    const b = await writeRaw(ctx, other, 'identical\n', {})
    if (!a.ok || !b.ok) throw new Error('setup failed')
    expect(a.value.etag).toBe(b.value.etag)

    const c = await writeRaw(ctx, DOC, 'different\n', { ifMatch: a.value.etag })
    if (!c.ok) throw new Error('replace failed')
    expect(c.value.etag).not.toBe(a.value.etag)
  })

  it('match what the next read returns', async () => {
    const w = await writeRaw(ctx, DOC, 'body\n', {})
    const r = await readRaw(ctx, DOC)
    if (!w.ok || !r.ok) throw new Error('setup failed')
    expect(r.value.etag).toBe(w.value.etag)
  })
})

describe('readRaw and exists', () => {
  it('returns NOT_FOUND for a missing document', async () => {
    const r = await readRaw(ctx, p('10-knowledge/nothing.md'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NOT_FOUND')
  })

  it('reports existence', async () => {
    expect(await exists(ctx, DOC)).toBe(false)
    await writeRaw(ctx, DOC, 'body\n', {})
    expect(await exists(ctx, DOC)).toBe(true)
  })
})

describe('the atomic write', () => {
  it('leaves no temp file behind on success', async () => {
    await writeRaw(ctx, DOC, 'first\n', {})
    expect(await tempFilesIn(DOC)).toEqual([])
  })

  it('leaves the original intact and no temp file when the rename fails', async () => {
    const created = await writeRaw(ctx, DOC, 'first\n', {})
    if (!created.ok) throw new Error('setup failed')

    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('simulated crash'))
    await expect(writeRaw(ctx, DOC, 'second\n', { ifMatch: created.value.etag })).rejects.toThrow(
      'simulated crash',
    )
    rename.mockRestore()

    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('first\n')
    expect(await tempFilesIn(DOC)).toEqual([])
  })

  it('releases the lock after a thrown filesystem failure', async () => {
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('simulated crash'))
    await expect(writeRaw(ctx, DOC, 'body\n', {})).rejects.toThrow('simulated crash')
    rename.mockRestore()

    const r = await writeRaw(ctx, DOC, 'body\n', {})
    expect(r.ok).toBe(true)
  })

  it('sweeps a temp file abandoned by an earlier crash', async () => {
    await writeRaw(ctx, DOC, 'first\n', {})
    const orphan = join(root, '20-projects', 'billing', '.notes.md.abandoned.tmp')
    await fs.writeFile(orphan, 'half a document', 'utf8')
    const old = new Date(Date.now() - 3 * 60 * 60 * 1_000)
    await fs.utimes(orphan, old, old)

    const again = await writeRaw(ctx, p('20-projects/billing/other.md'), 'body\n', {})
    expect(again.ok).toBe(true)
    expect(await tempFilesIn(DOC)).toEqual([])
  })
})

describe('appendRaw', () => {
  it('creates the document when it does not exist', async () => {
    const r = await appendRaw(ctx, DOC, '- captured\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.created).toBe(true)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('- captured\n')
  })

  it('lands twice with no ifMatch and keeps both fragments', async () => {
    const first = await appendRaw(ctx, DOC, '- one')
    const second = await appendRaw(ctx, DOC, '- two')
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.created).toBe(false)
    expect(second.value.etag).not.toBe(first.value.etag)

    const body = await fs.readFile(absOf(DOC), 'utf8')
    expect(body).toBe('- one\n\n- two\n')
  })

  it('serialises two concurrent appends and lands both', async () => {
    await writeRaw(ctx, DOC, '# Questions\n', {})
    await Promise.all([appendRaw(ctx, DOC, '- from A'), appendRaw(ctx, DOC, '- from B')])

    const body = await fs.readFile(absOf(DOC), 'utf8')
    expect(body).toContain('- from A')
    expect(body).toContain('- from B')
  })

  it('inserts before the next heading of the same level, not at the end of the file', async () => {
    const seed = [
      '---',
      'title: Billing',
      '---',
      '',
      '# Billing',
      '',
      '## Open questions',
      '',
      '- can we invoice monthly?',
      '',
      '### A subsection',
      '',
      'detail',
      '',
      '## Decisions',
      '',
      '- use Stripe',
      '',
    ].join('\n')
    await writeRaw(ctx, DOC, seed, {})

    const r = await appendRaw(ctx, DOC, '- what about refunds?', 'Open questions')
    expect(r.ok).toBe(true)

    const body = await fs.readFile(absOf(DOC), 'utf8')
    const lines = body.split('\n')
    expect(lines.indexOf('- what about refunds?')).toBeGreaterThan(lines.indexOf('detail'))
    expect(lines.indexOf('- what about refunds?')).toBeLessThan(lines.indexOf('## Decisions'))
    expect(body).toContain('- use Stripe')
  })

  it('matches the section case-insensitively and accepts a hashed name', async () => {
    await writeRaw(
      ctx,
      DOC,
      '# Billing\n\n## Open Questions\n\n- one\n\n## Decisions\n\n- two\n',
      {},
    )
    const r = await appendRaw(ctx, DOC, '- three', '## open questions')
    expect(r.ok).toBe(true)

    const lines = (await fs.readFile(absOf(DOC), 'utf8')).split('\n')
    expect(lines.indexOf('- three')).toBeLessThan(lines.indexOf('## Decisions'))
  })

  it('does not match a heading inside a fenced code block', async () => {
    const seed = ['# Doc', '', '```md', '## Notes', '```', '', '## Notes', '', '- real', ''].join(
      '\n',
    )
    await writeRaw(ctx, DOC, seed, {})
    await appendRaw(ctx, DOC, '- appended', 'Notes')

    const lines = (await fs.readFile(absOf(DOC), 'utf8')).split('\n')
    expect(lines.indexOf('- appended')).toBeGreaterThan(lines.indexOf('- real'))
  })

  it('appends at the end of the section when it is the last one', async () => {
    await writeRaw(ctx, DOC, '# Doc\n\n## Notes\n\n- one\n', {})
    await appendRaw(ctx, DOC, '- two', 'Notes')
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe(
      '# Doc\n\n## Notes\n\n- one\n\n- two\n',
    )
  })

  it('creates an unknown section at the end rather than failing', async () => {
    await writeRaw(ctx, DOC, '# Doc\n\n- one\n', {})
    const r = await appendRaw(ctx, DOC, '- captured', 'Open questions')
    expect(r.ok).toBe(true)

    const body = await fs.readFile(absOf(DOC), 'utf8')
    expect(body).toBe('# Doc\n\n- one\n\n## Open questions\n\n- captured\n')
  })

  it('creates the document and the section together', async () => {
    const r = await appendRaw(ctx, DOC, '- captured', 'Open questions')
    expect(r.ok).toBe(true)
    await expect(fs.readFile(absOf(DOC), 'utf8')).resolves.toBe('## Open questions\n\n- captured\n')
  })
})

describe('removeDoc', () => {
  it('soft deletes into the mirrored archive path', async () => {
    await writeRaw(ctx, DOC, 'body\n', {})
    const r = await removeDoc(ctx, DOC, {})
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value.archivedTo).toBe('90-archive/projects/billing/open-questions.md')
    expect(await exists(ctx, DOC)).toBe(false)
    const archived = r.value.archivedTo
    if (archived === undefined) return
    await expect(fs.readFile(absOf(archived), 'utf8')).resolves.toBe('body\n')
  })

  it('mirrors a root-level document', async () => {
    const rootDoc = p('content-structure.md')
    await writeRaw(ctx, rootDoc, 'structure\n', {})
    const r = await removeDoc(ctx, rootDoc, {})
    if (!r.ok) throw new Error('delete failed')
    expect(r.value.archivedTo).toBe('90-archive/content-structure.md')
  })

  it('dates the basename when something is already archived at the path', async () => {
    await writeRaw(ctx, DOC, 'first\n', {})
    const first = await removeDoc(ctx, DOC, {})
    expect(first.ok).toBe(true)

    await writeRaw(ctx, DOC, 'second\n', {})
    const second = await removeDoc(ctx, DOC, {})
    if (!second.ok) throw new Error('delete failed')
    expect(second.value.archivedTo).toMatch(
      /^90-archive\/projects\/billing\/open-questions-archived-\d{4}-\d{2}-\d{2}\.md$/,
    )

    await writeRaw(ctx, DOC, 'third\n', {})
    const third = await removeDoc(ctx, DOC, {})
    if (!third.ok) throw new Error('delete failed')
    expect(third.value.archivedTo).toMatch(/-archived-\d{4}-\d{2}-\d{2}-2\.md$/)
  })

  it('hard deletes by unlinking, with no archive copy', async () => {
    await writeRaw(ctx, DOC, 'body\n', {})
    const r = await removeDoc(ctx, DOC, { hard: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.archivedTo).toBeUndefined()
    expect(await exists(ctx, DOC)).toBe(false)
    expect(await exists(ctx, p('90-archive/projects/billing/open-questions.md'))).toBe(false)
  })

  it('returns NOT_FOUND for a document that is not there', async () => {
    const r = await removeDoc(ctx, DOC, {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NOT_FOUND')
  })
})

describe('withLock', () => {
  it('returns the wrapped value', async () => {
    const r = await withLock(ctx, DOC, async () => 42)
    expect(r).toEqual({ ok: true, value: 42 })
  })

  it('releases the lock when the wrapped function throws', async () => {
    await expect(
      withLock(ctx, DOC, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const after = await withLock(ctx, DOC, async () => 'acquired again')
    expect(after).toEqual({ ok: true, value: 'acquired again' })
  })

  it('never lets two holders overlap', async () => {
    const order: string[] = []
    await Promise.all([
      withLock(ctx, DOC, async () => {
        order.push('a-in')
        await new Promise((r) => setTimeout(r, 30))
        order.push('a-out')
      }),
      withLock(ctx, DOC, async () => {
        order.push('b-in')
        await new Promise((r) => setTimeout(r, 5))
        order.push('b-out')
      }),
    ])

    // Which one wins is a race and we don't care. What matters is that one
    // finishes before the other starts.
    expect(order).toHaveLength(4)
    expect([
      ['a-in', 'a-out', 'b-in', 'b-out'].join(),
      ['b-in', 'b-out', 'a-in', 'a-out'].join(),
    ]).toContain(order.join())
  })
})

describe('lock recovery', () => {
  it('breaks a lock whose holder stopped refreshing it', async () => {
    const lockDir = lockDirFor(DOC)
    await fs.mkdir(lockDir, { recursive: true })
    const abandoned = new Date(Date.now() - 30_000)
    await fs.utimes(lockDir, abandoned, abandoned)

    const r = await writeRaw(ctx, DOC, 'body\n', {})
    expect(r.ok).toBe(true)
  })

  it('gives CONFLICT when a live lock cannot be acquired', async () => {
    const lockDir = lockDirFor(DOC)
    await fs.mkdir(lockDir, { recursive: true })

    // Acquisition backs off for roughly five seconds before giving up.
    const r = await writeRaw(ctx, DOC, 'body\n', {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('CONFLICT')
    expect(r.error.message).toContain('retry')
    expect(await exists(ctx, DOC)).toBe(false)
  }, 20_000)
})
