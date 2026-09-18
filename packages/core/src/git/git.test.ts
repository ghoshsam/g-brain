import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuditPort } from '../audit/index.js'
import { writeDoc } from '../ops/index.js'
import { noopSearch } from '../ports.js'
import type { Actor, BrainConfig, BrainContext, DocPath } from '../types.js'
import { createGitPort } from './index.js'

const run = promisify(execFile)

const config = (brainRoot: string, overrides: Partial<BrainConfig> = {}): BrainConfig => ({
  brainRoot,
  gitAutocommit: true,
  gitAuthorSuffix: '@g-brain.local',
  // Short, so tests do not wait two seconds each.
  gitDebounceMs: 20,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 262_144,
  rateLimitPerMinute: 10_000,
  auditMaxBytes: 8_388_608,
  auditKeep: 8,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 90,
  ...overrides,
})

const capture: Actor = {
  id: 'capture-agent',
  name: 'capture-agent',
  scopes: [{ folder: '', read: true, write: true }],
}

let root: string
let gitAvailable = true

const contextWith = (overrides: Partial<BrainConfig> = {}) => {
  const settings = config(root, overrides)
  const git = createGitPort(root, settings)
  const context: BrainContext = {
    root,
    config: settings,
    actor: capture,
    git,
    audit: createAuditPort(root, settings),
    search: noopSearch,
  }
  return { context, git }
}

const commitLines = async (): Promise<string[]> => {
  const { stdout } = await run('git', ['log', '--pretty=%an|%s'], { cwd: root })
  return stdout.trim().split('\n').filter(Boolean)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-git-'))
  await writeFile(
    join(root, 'content-structure.md'),
    '# Structure\n\n## 10-knowledge/\n\nStuff.\n',
    'utf8',
  )

  try {
    await run('git', ['init', '--quiet'], { cwd: root })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await run('git', ['config', 'user.name', 'Test'], { cwd: root })
  } catch {
    gitAvailable = false
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const body = (title: string) => `---\ntitle: ${title}\ntype: note\n---\n\nContent for ${title}.\n`

describe('commit per write', () => {
  it('commits a write, authored as the agent that made it', async () => {
    if (!gitAvailable) return
    const { context, git } = contextWith()

    await writeDoc(context, { path: '10-knowledge/one.md', content: body('One') })
    await git.flush()

    const commits = await commitLines()
    expect(commits).toHaveLength(1)
    expect(commits[0]).toContain('capture-agent')
    expect(commits[0]).toContain('10-knowledge/one.md')
  })

  it('batches a burst into one commit rather than one each', async () => {
    if (!gitAvailable) return
    // A window wide enough that the timer cannot fire mid-burst, so flush() is
    // what commits and the batching is deterministic rather than a race.
    const { context, git } = contextWith({ gitDebounceMs: 60_000 })

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await writeDoc(context, { path: `10-knowledge/${name}.md`, content: body(name) })
    }
    await git.flush()

    const commits = await commitLines()
    expect(commits).toHaveLength(1)
    expect(commits[0]).toContain('and 5 more')
  })

  it('writes nothing to git when autocommit is off', async () => {
    if (!gitAvailable) return
    const { context, git } = contextWith({ gitAutocommit: false })

    await writeDoc(context, { path: '10-knowledge/quiet.md', content: body('Quiet') })
    await git.flush()

    // The document is on disk either way.
    const onDisk = await readFile(join(root, '10-knowledge', 'quiet.md'), 'utf8')
    expect(onDisk).toContain('Quiet')

    const { stdout } = await run('git', ['log', '--oneline'], { cwd: root }).catch(() => ({
      stdout: '',
    }))
    expect(stdout.trim()).toBe('')
  })

  it('never fails a write when git cannot commit', async () => {
    // A brain with no git repository at all.
    const bare = await mkdtemp(join(tmpdir(), 'gbrain-nogit-'))
    await writeFile(join(bare, 'content-structure.md'), '# S\n\n## 10-knowledge/\n\nx\n', 'utf8')

    const settings = config(bare)
    const git = createGitPort(bare, settings)
    const context: BrainContext = {
      root: bare,
      config: settings,
      actor: capture,
      git,
      audit: createAuditPort(bare, settings),
      search: noopSearch,
    }

    const result = await writeDoc(context, { path: '10-knowledge/x.md', content: body('X') })
    await git.flush()

    expect(result.ok).toBe(true)
    expect(await readFile(join(bare, '10-knowledge', 'x.md'), 'utf8')).toContain('X')

    await rm(bare, { recursive: true, force: true })
  })
})

describe('history and revert', () => {
  it('lists the revisions of one document', async () => {
    if (!gitAvailable) return
    const { context, git } = contextWith()

    const first = await writeDoc(context, { path: '10-knowledge/h.md', content: body('First') })
    await git.flush()
    if (!first.ok) return

    await writeDoc(context, {
      path: '10-knowledge/h.md',
      content: body('Second'),
      ifMatch: first.value.etag,
    })
    await git.flush()

    const history = await git.history('10-knowledge/h.md' as DocPath)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value).toHaveLength(2)
    expect(history.value[0]?.author).toBe('capture-agent')
  })

  it('reverts by adding a new commit, leaving the old one reachable', async () => {
    if (!gitAvailable) return
    const { context, git } = contextWith()
    const path = '10-knowledge/r.md' as DocPath

    const first = await writeDoc(context, { path, content: body('Original') })
    await git.flush()
    if (!first.ok) return

    await writeDoc(context, { path, content: body('Replaced'), ifMatch: first.value.etag })
    await git.flush()

    const history = await git.history(path)
    if (!history.ok) return
    const oldestSha = history.value[history.value.length - 1]?.sha ?? ''

    const reverted = await git.revert(path, oldestSha, capture)
    expect(reverted.ok).toBe(true)

    expect(await readFile(join(root, '10-knowledge', 'r.md'), 'utf8')).toContain('Original')

    // Three commits, not two: history was added to, never rewritten.
    const after = await git.history(path)
    if (!after.ok) return
    expect(after.value).toHaveLength(3)
    expect(after.value.some((r) => r.sha === oldestSha)).toBe(true)
  })

  it('reads a document as it was at a revision', async () => {
    if (!gitAvailable) return
    const { context, git } = contextWith()
    const path = '10-knowledge/s.md' as DocPath

    const first = await writeDoc(context, { path, content: body('Then') })
    await git.flush()
    if (!first.ok) return

    const history = await git.history(path)
    if (!history.ok) return
    const sha = history.value[0]?.sha ?? ''

    await writeDoc(context, { path, content: body('Now'), ifMatch: first.value.etag })
    await git.flush()

    const past = await git.showAt(path, sha)
    expect(past.ok).toBe(true)
    if (past.ok) expect(past.value).toContain('Then')
  })
})
