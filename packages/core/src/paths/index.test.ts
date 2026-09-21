import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { noopAudit, noopGit, noopSearch } from '../ports.js'
import type { BrainConfig, BrainContext, DocPath } from '../types.js'
import { containPath, folderOf, toAbsolute } from './index.js'

const config: BrainConfig = {
  brainRoot: '',
  gitAutocommit: false,
  gitAuthorSuffix: '@g-brain.local',
  gitDebounceMs: 2000,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 262144,
  rateLimitPerMinute: 120,
  auditMaxBytes: 8388608,
  auditKeep: 8,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 90,
  projectsFolder: '20-projects',
}

const contextFor = (root: string): BrainContext => ({
  root,
  config: { ...config, brainRoot: root },
  actor: { id: 'local', name: 'local', scopes: [{ folder: '', read: true, write: true }] },
  git: noopGit,
  audit: noopAudit,
  search: noopSearch,
})

let tmp = ''
let root = ''
let ctx: BrainContext

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'g-brain-paths-'))
  root = join(tmp, 'brain')
  await mkdir(root, { recursive: true })
  ctx = contextFor(root)
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const rejected = (raw: string) => {
  const result = containPath(ctx, raw)
  expect(result.ok, `${JSON.stringify(raw)} must be rejected`).toBe(false)
  return result.ok ? null : result.error
}

const accepted = (raw: string): DocPath => {
  const result = containPath(ctx, raw)
  expect(result.ok, `${JSON.stringify(raw)} must be accepted`).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('containPath rejects', () => {
  it('traversal that escapes the root', () => {
    for (const raw of ['../../etc/passwd', '../outside.md', 'a/../../b.md', '..']) {
      expect(rejected(raw)?.code).toBe('INVALID_PATH')
    }
  })

  it('percent-encoded traversal', () => {
    expect(rejected('..%2f..%2fb.md')?.code).toBe('INVALID_PATH')
    expect(rejected('%2e%2e/%2e%2e/b.md')?.code).toBe('INVALID_PATH')
  })

  it('absolute POSIX paths', () => {
    expect(rejected('/etc/passwd')?.code).toBe('INVALID_PATH')
    expect(rejected('/notes.md')?.code).toBe('INVALID_PATH')
  })

  it('Windows drive letters and UNC shares', () => {
    expect(rejected('C:\\Windows\\x.md')?.code).toBe('INVALID_PATH')
    expect(rejected('c:/windows/x.md')?.code).toBe('INVALID_PATH')
    expect(rejected('\\\\server\\share\\x.md')?.code).toBe('INVALID_PATH')
  })

  it('a null byte', () => {
    const nullByte = `notes.md${String.fromCharCode(0)}.txt`
    expect(rejected(nullByte)?.code).toBe('INVALID_PATH')
  })

  it('anything that is not a .md document', () => {
    for (const raw of ['notes.txt', 'diagram.png', 'notes.md.bak', 'README', '.md']) {
      expect(rejected(raw)?.code).toBe('INVALID_PATH')
    }
  })

  it('the reserved .git and .brain prefixes', () => {
    expect(rejected('.git/config')?.code).toBe('INVALID_PATH')
    expect(rejected('.brain/audit.jsonl')?.code).toBe('INVALID_PATH')
    expect(rejected('.git/hooks/pre-commit.md')?.message).toContain('reserved')
    expect(rejected('.brain/agents.md')?.message).toContain('reserved')
  })

  it('an empty path', () => {
    expect(rejected('')?.code).toBe('INVALID_PATH')
    expect(rejected('   ')?.code).toBe('INVALID_PATH')
  })

  it('a path escaping the root through a symlinked directory', async () => {
    const outside = join(tmp, 'outside')
    await mkdir(outside, { recursive: true })
    try {
      await symlink(outside, join(root, 'escape-hatch'), 'junction')
    } catch {
      return
    }

    expect(rejected('escape-hatch/x.md')?.code).toBe('INVALID_PATH')
  })

  it('and names what was wrong in a message an agent can act on', () => {
    expect(rejected('notes.txt')?.message).toContain('.md')
    expect(rejected('/etc/passwd.md')?.message).toContain('relative')
  })
})

describe('containPath accepts', () => {
  it('a nested document', () => {
    expect(accepted('10-knowledge/auth/x.md')).toBe('10-knowledge/auth/x.md')
  })

  it('a document at the brain root, including content-structure.md', () => {
    expect(accepted('content-structure.md')).toBe('content-structure.md')
  })

  it('and normalises a path that walks back into the root', () => {
    expect(accepted('a/../b.md')).toBe('b.md')
    expect(accepted('./10-knowledge/./x.md')).toBe('10-knowledge/x.md')
    expect(accepted('10-knowledge//auth/x.md')).toBe('10-knowledge/auth/x.md')
  })

  it('and normalises backslash separators to forward slashes', () => {
    expect(accepted('10-knowledge\\auth\\x.md')).toBe('10-knowledge/auth/x.md')
  })

  it('a folder nobody has described — structure is never consulted', () => {
    expect(accepted('99-nowhere-declared/x.md')).toBe('99-nowhere-declared/x.md')
  })

  it('a document that does not exist — existence is core/store, not core/paths', () => {
    expect(accepted('10-knowledge/never-written.md')).toBe('10-knowledge/never-written.md')
  })
})

describe('toAbsolute', () => {
  it('rebuilds a platform path under the brain root', () => {
    expect(toAbsolute(ctx, accepted('10-knowledge/auth/x.md'))).toBe(
      join(root, '10-knowledge', 'auth', 'x.md'),
    )
  })
})

describe('folderOf', () => {
  it("returns '' for a document at the brain root", () => {
    expect(folderOf(accepted('content-structure.md'))).toBe('')
  })

  it('returns the folder prefix for a nested document', () => {
    expect(folderOf(accepted('10-knowledge/auth/x.md'))).toBe('10-knowledge/auth')
    expect(folderOf(accepted('00-inbox/note.md'))).toBe('00-inbox')
  })
})
