import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../guards/index.js'
import { noopGit, noopSearch } from '../ports.js'
import type { Actor, AuditEntry, AuditPort, BrainConfig, BrainContext } from '../types.js'
import { appendDoc, deleteDoc, listDocs, readDoc, writeDoc } from './index.js'

const STRUCTURE = `# Content Structure

## 00-inbox/

Captures that do not clearly belong anywhere else yet.

## 10-knowledge/{topic}/

Durable reference that outlives any single project.

## 90-archive/

Finished or superseded content.
`

// A real AuditPort would append to .brain/audit.jsonl. Collecting in an array
// lets a test assert what was recorded without reading a file back.
const collectingAudit = () => {
  const entries: AuditEntry[] = []
  const port: AuditPort = {
    record: (entry) => entries.push(entry),
    tail: async () => entries,
  }
  return { entries, port }
}

const config = (overrides: Partial<BrainConfig> = {}): BrainConfig => ({
  brainRoot: '',
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
  projectsFolder: '20-projects',
  ...overrides,
})

const fullAccess: Actor = {
  id: 'capture',
  name: 'capture',
  scopes: [{ folder: '', read: true, write: true }],
}

let root: string
let audit: ReturnType<typeof collectingAudit>
let ctx: BrainContext

const contextFor = (actor: Actor, overrides: Partial<BrainConfig> = {}): BrainContext => ({
  root,
  config: config({ brainRoot: root, ...overrides }),
  actor,
  git: noopGit,
  audit: audit.port,
  search: noopSearch,
})

beforeEach(async () => {
  resetRateLimits()
  root = await mkdtemp(join(tmpdir(), 'gbrain-ops-'))
  await writeFile(join(root, 'content-structure.md'), STRUCTURE, 'utf8')
  await mkdir(join(root, '10-knowledge', 'auth'), { recursive: true })
  audit = collectingAudit()
  ctx = contextFor(fullAccess)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const body = (title: string, text = 'Some durable content about tokens.') =>
  `---\ntitle: ${title}\ntype: how-to\ntags: [auth]\n---\n\n${text}\n`

describe('writeDoc', () => {
  it('creates a document and stamps the dates', async () => {
    const result = await writeDoc(ctx, {
      path: '10-knowledge/auth/tokens.md',
      content: body('Tokens'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.created).toBe(true)
    expect(result.value.etag).toBeTruthy()
    expect(result.value.stamped).toContain('created')
    expect(result.value.stamped).toContain('updated')

    const onDisk = await readFile(join(root, '10-knowledge', 'auth', 'tokens.md'), 'utf8')
    expect(onDisk).toContain('title: Tokens')
    expect(onDisk).toContain('created:')
  })

  it('refuses to replace without ifMatch, and accepts the right one', async () => {
    const first = await writeDoc(ctx, {
      path: '10-knowledge/auth/tokens.md',
      content: body('Tokens'),
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const blind = await writeDoc(ctx, {
      path: '10-knowledge/auth/tokens.md',
      content: body('Tokens', 'Rewritten.'),
    })
    expect(blind.ok).toBe(false)
    if (!blind.ok) expect(blind.error.code).toBe('PRECONDITION_REQUIRED')

    const withEtag = await writeDoc(ctx, {
      path: '10-knowledge/auth/tokens.md',
      content: body('Tokens', 'Rewritten.'),
      ifMatch: first.value.etag,
    })
    expect(withEtag.ok).toBe(true)
  })

  it('rejects a path that escapes the brain root', async () => {
    const result = await writeDoc(ctx, { path: '../escape.md', content: body('Nope') })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_PATH')
  })

  it('refuses a credential and writes nothing to disk', async () => {
    const withKey =
      '---\ntitle: Setup\n---\n\nAWS_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'

    const result = await writeDoc(ctx, { path: '00-inbox/setup.md', content: withKey })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_CONTENT')

    await expect(readFile(join(root, '00-inbox', 'setup.md'), 'utf8')).rejects.toThrow()
  })

  it('logs a rejected credential — no commit means this is the only trace', async () => {
    const withKey =
      '---\ntitle: Setup\n---\n\nAWS_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'
    await writeDoc(ctx, { path: '00-inbox/setup.md', content: withKey })

    const rejected = audit.entries.find((e) => e.outcome === 'rejected')
    expect(rejected?.errorCode).toBe('UNSAFE_CONTENT')
    expect(rejected?.finding).toBeTruthy()
    // The rule name is recorded. The secret itself never is.
    expect(JSON.stringify(audit.entries)).not.toContain('wJalrXUtnFEMI')
  })

  it('rejects a body over the size limit', async () => {
    const ctxSmall = contextFor(fullAccess, { maxDocBytes: 64 })
    const result = await writeDoc(ctxSmall, {
      path: '00-inbox/big.md',
      content: body('Big', 'x'.repeat(500)),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TOO_LARGE')
  })

  it('refuses a write outside the actor scope', async () => {
    const narrow: Actor = {
      id: 'ci',
      name: 'ci',
      scopes: [{ folder: '20-projects', read: true, write: true }],
    }
    const result = await writeDoc(contextFor(narrow), {
      path: '10-knowledge/auth/tokens.md',
      content: body('Tokens'),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('a read-only actor cannot write anywhere', async () => {
    const readOnly: Actor = {
      id: 'recall',
      name: 'recall',
      scopes: [{ folder: '', read: true, write: false }],
    }
    for (const path of ['00-inbox/a.md', '10-knowledge/auth/b.md', '90-archive/c.md']) {
      const result = await writeDoc(contextFor(readOnly), { path, content: body('X') })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    }
  })
})

describe('drift — the rule that keeps captures happening', () => {
  it('a write to an undeclared folder SUCCEEDS and is flagged', async () => {
    const result = await writeDoc(ctx, {
      path: '77-experiments/spike.md',
      content: body('Spike'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.drift?.reason).toBe('undeclared-folder')

    // Flagged, not refused. The document is really there.
    const onDisk = await readFile(join(root, '77-experiments', 'spike.md'), 'utf8')
    expect(onDisk).toContain('title: Spike')

    const entry = audit.entries.find((e) => e.path === '77-experiments/spike.md')
    expect(entry?.outcome).toBe('ok')
    expect(entry?.drift).toBe(true)
  })

  it('a document missing a title is written, with a lint warning', async () => {
    const result = await writeDoc(ctx, {
      path: '00-inbox/untitled.md',
      content: 'Just a body, no frontmatter at all.\n',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.lint.map((f) => f.rule)).toContain('missing-title')
  })
})

describe('appendDoc', () => {
  it('needs no ifMatch and both appends land', async () => {
    await writeDoc(ctx, { path: '20-projects/x/status.md', content: body('Status') })

    const a = await appendDoc(ctx, { path: '20-projects/x/status.md', content: 'First note.\n' })
    const b = await appendDoc(ctx, { path: '20-projects/x/status.md', content: 'Second note.\n' })

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)

    const onDisk = await readFile(join(root, '20-projects', 'x', 'status.md'), 'utf8')
    expect(onDisk).toContain('First note.')
    expect(onDisk).toContain('Second note.')
  })

  it('still refuses a credential', async () => {
    await writeDoc(ctx, { path: '00-inbox/notes.md', content: body('Notes') })
    const result = await appendDoc(ctx, {
      path: '00-inbox/notes.md',
      content: 'token = ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSAFE_CONTENT')
  })
})

describe('readDoc', () => {
  it('round-trips what was written', async () => {
    await writeDoc(ctx, { path: '10-knowledge/auth/tokens.md', content: body('Tokens') })

    const result = await readDoc(ctx, { path: '10-knowledge/auth/tokens.md' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.meta.title).toBe('Tokens')
    expect(result.value.body).toContain('durable content')
  })

  it('reports a missing document', async () => {
    const result = await readDoc(ctx, { path: '10-knowledge/auth/nope.md' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('deleteDoc', () => {
  it('archives rather than destroying', async () => {
    await writeDoc(ctx, { path: '20-projects/x/notes.md', content: body('Notes') })

    const result = await deleteDoc(ctx, { path: '20-projects/x/notes.md' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const archivedTo = result.value.archivedTo
    expect(archivedTo).toContain('90-archive')
    if (archivedTo === undefined) return

    const archived = await readFile(join(root, ...archivedTo.split('/')), 'utf8')
    expect(archived).toContain('title: Notes')
  })
})

describe('listDocs', () => {
  beforeEach(async () => {
    await writeDoc(ctx, { path: '10-knowledge/auth/tokens.md', content: body('Tokens') })
    await writeDoc(ctx, {
      path: '10-knowledge/auth/sessions.md',
      content:
        '---\ntitle: Sessions\ntype: reference\ntags: [auth, session]\n---\n\nDistinct content here about session storage and lifetimes.\n',
    })
    await writeDoc(ctx, { path: '00-inbox/stray.md', content: body('Stray', 'Unrelated text.') })
  })

  it('filters by folder', async () => {
    const result = await listDocs(ctx, { folder: '10-knowledge' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(2)
  })

  it('filters by type and returns metadata only', async () => {
    const result = await listDocs(ctx, { type: 'reference' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(1)
    expect(result.value.items[0]?.title).toBe('Sessions')
    expect(result.value.items[0]).not.toHaveProperty('body')
  })

  it('hides folders the actor cannot read', async () => {
    const narrow: Actor = {
      id: 'inbox-only',
      name: 'inbox-only',
      scopes: [{ folder: '00-inbox', read: true, write: false }],
    }
    const result = await listDocs(contextFor(narrow), {})

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((m) => m.path.startsWith('00-inbox/'))).toBe(true)
  })
})

describe('near-duplicate detection', () => {
  const shared =
    'Access tokens live for fifteen minutes and are refreshed with a rotating refresh token that is single use. Refreshing twice at once revokes the session.\n'

  it('catches an identical body in the same folder, frontmatter aside', async () => {
    // Regression: the incoming document was compared with its frontmatter
    // against a stored one without, so two identical bodies scored well under
    // the threshold and both got written.
    await writeDoc(ctx, {
      path: '10-knowledge/auth/refresh.md',
      content: `---\ntitle: Refresh tokens\ntype: how-to\n---\n\n${shared}`,
    })

    const second = await writeDoc(ctx, {
      path: '10-knowledge/auth/refresh-again.md',
      content: `---\ntitle: Refresh tokens again\ntype: reference\ntags: [auth, oidc]\n---\n\n${shared}`,
    })

    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('CONFLICT')
      expect(second.error.details?.existingPath).toBe('10-knowledge/auth/refresh.md')
    }
  })

  it('lets force through, because the guard is a heuristic', async () => {
    await writeDoc(ctx, {
      path: '10-knowledge/auth/refresh.md',
      content: `---\ntitle: Refresh tokens\n---\n\n${shared}`,
    })

    const forced = await writeDoc(ctx, {
      path: '10-knowledge/auth/refresh-again.md',
      content: `---\ntitle: Refresh tokens again\n---\n\n${shared}`,
      force: true,
    })

    expect(forced.ok).toBe(true)
  })

  it('does not flag genuinely different documents', async () => {
    await writeDoc(ctx, {
      path: '10-knowledge/auth/refresh.md',
      content: `---\ntitle: Refresh tokens\n---\n\n${shared}`,
    })

    const different = await writeDoc(ctx, {
      path: '10-knowledge/auth/rate-limits.md',
      content:
        '---\ntitle: Rate limits\n---\n\nThe gateway allows one hundred requests a minute per key, measured in a sliding window.\n',
    })

    expect(different.ok).toBe(true)
  })
})
