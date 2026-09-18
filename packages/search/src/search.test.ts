import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSearchPort } from './port.js'

let root: string

const write = async (path: string, content: string) => {
  const full = join(root, ...path.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

const doc = (title: string, body: string, front: Record<string, string> = {}) => {
  const extra = Object.entries(front)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---\ntitle: ${title}\n${extra}\n---\n\n${body}\n`
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-search-'))
  await writeFile(
    join(root, 'content-structure.md'),
    '# Structure\n\n## 10-knowledge/\n\nStuff.\n',
    'utf8',
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ranking', () => {
  it('ranks a title match above the same term buried in a body', async () => {
    await write('10-knowledge/titled.md', doc('Dunning retries', 'Unrelated prose about queues.'))
    await write(
      '10-knowledge/buried.md',
      doc('Queue behaviour', 'A long body that mentions dunning retries somewhere in the middle.'),
    )

    const search = createSearchPort(root)
    const result = await search.search({ q: 'dunning retries' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]?.path).toBe('10-knowledge/titled.md')
  })

  it('de-prioritises the archive without excluding it', async () => {
    const body = 'Dunning retries compound when the payment queue backs up.'
    await write('10-knowledge/live.md', doc('Dunning retries', body))
    await write('90-archive/old.md', doc('Dunning retries', body, { status: 'superseded' }))

    const search = createSearchPort(root)
    const result = await search.search({ q: 'dunning retries' })
    if (!result.ok) return

    // Present, but below the live document. Excluding it would make superseded
    // decisions invisible, which is half the reason they are kept.
    expect(result.value).toHaveLength(2)
    expect(result.value[0]?.path).toBe('10-knowledge/live.md')
    expect(result.value[1]?.path).toBe('90-archive/old.md')
  })
})

describe('filters', () => {
  beforeEach(async () => {
    await write(
      '10-knowledge/auth/tokens.md',
      doc('Tokens', 'Refreshing access tokens.', { type: 'how-to', tags: '[auth]' }),
    )
    await write(
      '20-projects/billing/notes.md',
      doc('Billing notes', 'Refreshing our billing approach.', { type: 'note', tags: '[billing]' }),
    )
  })

  it('narrows by folder', async () => {
    const search = createSearchPort(root)
    const result = await search.search({ q: 'refreshing', folder: '10-knowledge' })
    if (!result.ok) return

    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.path).toBe('10-knowledge/auth/tokens.md')
  })

  it('narrows by tag', async () => {
    const search = createSearchPort(root)
    const result = await search.search({ q: 'refreshing', tag: 'billing' })
    if (!result.ok) return

    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.path).toBe('20-projects/billing/notes.md')
  })

  it('narrows by type', async () => {
    const search = createSearchPort(root)
    const result = await search.search({ q: 'refreshing', type: 'how-to' })
    if (!result.ok) return

    expect(result.value.every((hit) => hit.path.startsWith('10-knowledge'))).toBe(true)
  })
})

describe('the index holds no authority', () => {
  it('rebuilds from the files, losing nothing', async () => {
    await write('10-knowledge/a.md', doc('A', 'Findable content about widgets.'))

    const search = createSearchPort(root)
    const first = await search.search({ q: 'widgets' })
    if (!first.ok) return
    expect(first.value).toHaveLength(1)

    const rebuilt = await search.rebuild()
    expect(rebuilt.ok).toBe(true)
    if (rebuilt.ok) expect(rebuilt.value.documents).toBe(1)

    const after = await search.search({ q: 'widgets' })
    if (!after.ok) return
    expect(after.value).toHaveLength(1)
  })

  it('picks up a document written after the index was built', async () => {
    const search = createSearchPort(root)
    await search.search({ q: 'anything' }) // forces the first build

    await write('10-knowledge/new.md', doc('New', 'Content about sprockets.'))
    search.onWrite('10-knowledge/new.md' as never)

    // onWrite is fire-and-forget so a write never waits on the index.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const result = await search.search({ q: 'sprockets' })
    if (!result.ok) return
    expect(result.value[0]?.path).toBe('10-knowledge/new.md')
  })

  it('reports its freshness honestly', async () => {
    const search = createSearchPort(root)
    expect(search.freshness().stale).toBe(true)

    await write('10-knowledge/a.md', doc('A', 'Body.'))
    await search.rebuild()

    const fresh = search.freshness()
    expect(fresh.stale).toBe(false)
    expect(fresh.documents).toBe(1)
    expect(fresh.builtAt).not.toBeNull()
  })

  it('leaves the convention and the README out of the index', async () => {
    await writeFile(join(root, 'README.md'), '# Brain\n\nScaffolding.\n', 'utf8')
    await write('10-knowledge/a.md', doc('A', 'Real content.'))

    const search = createSearchPort(root)
    const rebuilt = await search.rebuild()
    if (rebuilt.ok) expect(rebuilt.value.documents).toBe(1)
  })
})

describe('similar', () => {
  it('finds a candidate in the same folder for the duplicate guard', async () => {
    const body = 'Access tokens are refreshed by the gateway using a rotating refresh token.'
    await write('10-knowledge/existing.md', doc('Existing', body))
    await write('20-projects/elsewhere.md', doc('Elsewhere', body))

    const search = createSearchPort(root)
    const candidates = await search.similar(body, '10-knowledge', 5)

    expect(candidates.map((c) => c.path)).toEqual(['10-knowledge/existing.md'])
  })

  it('returns nothing for a body with no distinctive words', async () => {
    await write('10-knowledge/a.md', doc('A', 'Real content here.'))

    const search = createSearchPort(root)
    expect(await search.similar('a b c', '10-knowledge', 5)).toEqual([])
  })
})
