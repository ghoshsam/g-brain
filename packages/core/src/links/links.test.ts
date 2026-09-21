import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noopAudit, noopGit, noopSearch } from '../ports.js'
import type { BrainConfig, BrainContext, DocPath } from '../types.js'
import { extractLinks, getLinks } from './index.js'

const p = (value: string): DocPath => value as DocPath

const config = (brainRoot: string): BrainConfig => ({
  brainRoot,
  gitAutocommit: false,
  gitAuthorSuffix: '',
  gitDebounceMs: 0,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 1_000_000,
  rateLimitPerMinute: 60,
  auditMaxBytes: 1_000_000,
  auditKeep: 3,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 90,
  projectsFolder: '20-projects',
})

const context = (root: string): BrainContext => ({
  root,
  config: config(root),
  actor: { id: 'local', name: 'local', scopes: [{ folder: '', read: true, write: true }] },
  git: noopGit,
  audit: noopAudit,
  search: noopSearch,
})

describe('extractLinks', () => {
  it('extracts both the wiki and the relative markdown syntax', () => {
    const body = [
      'See [[10-knowledge/auth/oidc-token-refresh.md]] and',
      'also [the gateway](../gateway/overview.md).',
    ].join('\n')

    const links = extractLinks(p('10-knowledge/auth/tokens.md'), body)

    expect(links.map((l) => l.target)).toEqual([
      '10-knowledge/auth/oidc-token-refresh.md',
      '10-knowledge/gateway/overview.md',
    ])
    expect(links.every((l) => l.broken === false)).toBe(true)
  })

  it('keeps the link as written in raw', () => {
    const links = extractLinks(p('a/b.md'), '[x](../c/d.md#section)')

    expect(links[0]?.raw).toBe('../c/d.md#section')
    expect(links[0]?.target).toBe('c/d.md')
  })

  it('ignores external URLs, bare anchors and non-markdown targets', () => {
    const body = [
      '[site](https://example.com/page.md)',
      '[mail](mailto:sam@example.com)',
      '[jump](#a-section)',
      '[image](../diagram.png)',
      '[proto](http://example.com)',
    ].join('\n')

    expect(extractLinks(p('10-knowledge/x.md'), body)).toEqual([])
  })

  it('resolves a relative link against the containing folder', () => {
    const links = extractLinks(p('20-projects/gateway/notes.md'), '[a](../../10-knowledge/auth.md)')
    expect(links[0]?.target).toBe('10-knowledge/auth.md')
  })

  it('ignores links inside fenced code blocks', () => {
    const body = [
      'Real [[10-knowledge/real.md]]',
      '```md',
      'Fake [[10-knowledge/fake.md]] and [also](./other.md)',
      '```',
      '~~~',
      '[[10-knowledge/tilde.md]]',
      '~~~',
    ].join('\n')

    expect(extractLinks(p('10-knowledge/x.md'), body).map((l) => l.target)).toEqual([
      '10-knowledge/real.md',
    ])
  })

  it('returns nothing for a document with no links', () => {
    expect(extractLinks(p('10-knowledge/x.md'), 'Plain prose, no links at all.')).toEqual([])
  })
})

describe('getLinks', () => {
  let root = ''

  const write = async (path: string, content: string): Promise<void> => {
    const absolute = join(root, ...path.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'g-brain-links-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns NOT_FOUND for a document that does not exist', async () => {
    const result = await getLinks(context(root), p('10-knowledge/missing.md'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('marks a link whose target is missing as broken', async () => {
    await write('10-knowledge/here.md', 'Gone: [[10-knowledge/gone.md]]\n')

    const result = await getLinks(context(root), p('10-knowledge/here.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outgoing).toHaveLength(1)
    expect(result.value.outgoing[0]?.broken).toBe(true)
  })

  it('marks a link whose target exists as not broken', async () => {
    await write('10-knowledge/auth/oidc.md', '# OIDC\n')
    await write('20-projects/gateway/notes.md', 'See [oidc](../../10-knowledge/auth/oidc.md).\n')

    const result = await getLinks(context(root), p('20-projects/gateway/notes.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outgoing[0]?.target).toBe('10-knowledge/auth/oidc.md')
    expect(result.value.outgoing[0]?.broken).toBe(false)
  })

  it('reports a link that would leave the brain root as broken', async () => {
    await write('10-knowledge/here.md', '[out](../../../etc/passwd.md)\n')

    const result = await getLinks(context(root), p('10-knowledge/here.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outgoing[0]?.broken).toBe(true)
  })

  it('finds backlinks from another document', async () => {
    await write('10-knowledge/auth/oidc.md', '# OIDC\n')
    await write('20-projects/gateway/notes.md', 'See [[10-knowledge/auth/oidc.md]].\n')
    await write('30-people/sam.md', 'Owns [oidc](../10-knowledge/auth/oidc.md).\n')
    await write('90-archive/unrelated.md', 'Nothing here.\n')

    const result = await getLinks(context(root), p('10-knowledge/auth/oidc.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.backlinks.map((l) => l.target).sort()).toEqual([
      '20-projects/gateway/notes.md',
      '30-people/sam.md',
    ])
    expect(result.value.backlinks.every((l) => l.broken === false)).toBe(true)
  })

  it('ignores links in a document that only mentions the path in frontmatter', async () => {
    await write('10-knowledge/auth/oidc.md', '# OIDC\n')
    await write(
      '10-knowledge/auth/old.md',
      '---\nsuperseded-by: 10-knowledge/auth/oidc.md\n---\n\nNo links here.\n',
    )

    const result = await getLinks(context(root), p('10-knowledge/auth/oidc.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.backlinks).toEqual([])
  })

  it('returns empty arrays for a document with no links and nothing pointing at it', async () => {
    await write('10-knowledge/lonely.md', '---\ntitle: Lonely\n---\n\nNo links.\n')

    const result = await getLinks(context(root), p('10-knowledge/lonely.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.path).toBe('10-knowledge/lonely.md')
    expect(result.value.outgoing).toEqual([])
    expect(result.value.backlinks).toEqual([])
  })

  it('skips .git and .brain when computing backlinks', async () => {
    await write('10-knowledge/auth/oidc.md', '# OIDC\n')
    await write('.git/notes.md', '[[10-knowledge/auth/oidc.md]]\n')
    await write('.brain/cache.md', '[[10-knowledge/auth/oidc.md]]\n')

    const result = await getLinks(context(root), p('10-knowledge/auth/oidc.md'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.backlinks).toEqual([])
  })
})
