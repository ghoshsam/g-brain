import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noopGit, noopSearch } from '../ports.js'
import type { Actor, AuditPort, BrainConfig, BrainContext, DocPath } from '../types.js'
import { checkDrift, getStructure } from './index.js'

const ROOT_STRUCTURE = `# Content Structure

## 05-memory/

How we work, everywhere.

## 20-projects/{project}/

Everything scoped to one active piece of work.
`

const PROJECT_STRUCTURE = `# Billing

How this project files things.

## memory/

Rules that apply to billing and nowhere else.

## research/

Vendor comparisons and pricing notes.
`

const config = (root: string): BrainConfig => ({
  brainRoot: root,
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
})

const silentAudit: AuditPort = { record: () => {}, tail: async () => [] }

const everywhere: Actor = {
  id: 'curator',
  name: 'curator',
  scopes: [{ folder: '', read: true, write: true }],
}

const onlyBilling: Actor = {
  id: 'billing-reader',
  name: 'billing-reader',
  scopes: [{ folder: '20-projects/billing', read: true, write: false }],
}

let root: string

const contextFor = (actor: Actor): BrainContext => ({
  root,
  config: config(root),
  actor,
  git: noopGit,
  audit: silentAudit,
  search: noopSearch,
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-projstruct-'))
  await writeFile(join(root, 'content-structure.md'), ROOT_STRUCTURE, 'utf8')

  await mkdir(join(root, '20-projects', 'billing', 'memory'), { recursive: true })
  await mkdir(join(root, '20-projects', 'billing', 'research'), { recursive: true })
  await mkdir(join(root, '20-projects', 'plain'), { recursive: true })

  await writeFile(
    join(root, '20-projects', 'billing', 'content-structure.md'),
    PROJECT_STRUCTURE,
    'utf8',
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('a project can carry its own content structure', () => {
  it('returns the project document verbatim, not the root one', async () => {
    const result = await getStructure(contextFor(everywhere), { project: 'billing' })
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value.markdown).toBe(PROJECT_STRUCTURE)
    expect(result.value.structureMissing).toBe(false)
  })

  it('returns the tree of that project, not of the whole brain', async () => {
    const result = await getStructure(contextFor(everywhere), { project: 'billing' })
    if (!result.ok) throw new Error(result.error.code)

    const paths = result.value.tree.map((node) => node.path)
    expect(paths).toEqual(['20-projects/billing/memory', '20-projects/billing/research'])
  })

  it('reports a project with no structure document as missing, rather than failing', async () => {
    const result = await getStructure(contextFor(everywhere), { project: 'plain' })
    if (!result.ok) throw new Error(result.error.code)

    // A project without its own convention is the normal case, not an error.
    expect(result.value.structureMissing).toBe(true)
    expect(result.value.markdown).toBe('')
  })

  it('is NOT_FOUND for a project that does not exist', async () => {
    const result = await getStructure(contextFor(everywhere), { project: 'nope' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('refuses a project the actor cannot read', async () => {
    await mkdir(join(root, '20-projects', 'secret'), { recursive: true })

    const result = await getStructure(contextFor(onlyBilling), { project: 'secret' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('still returns the root document when no project is asked for', async () => {
    const result = await getStructure(contextFor(everywhere))
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value.markdown).toBe(ROOT_STRUCTURE)
  })
})

describe('drift is measured against the convention that governs the folder', () => {
  it('does not flag a folder the project declares', async () => {
    const drift = await checkDrift(
      contextFor(everywhere),
      '20-projects/billing/memory/pnpm.md' as DocPath,
    )

    // The root document cannot describe a project's internals, so before this
    // existed every project subfolder was drift.
    expect(drift).toBeNull()
  })

  it('flags a folder the project does not declare', async () => {
    const drift = await checkDrift(
      contextFor(everywhere),
      '20-projects/billing/invoices/q1.md' as DocPath,
    )

    expect(drift?.reason).toBe('undeclared-folder')
  })

  it('does not flag a document sitting directly in the project folder', async () => {
    const drift = await checkDrift(
      contextFor(everywhere),
      '20-projects/billing/status.md' as DocPath,
    )

    expect(drift).toBeNull()
  })

  it('falls back to the root document for a project with no convention of its own', async () => {
    const drift = await checkDrift(contextFor(everywhere), '20-projects/plain/notes.md' as DocPath)

    expect(drift).toBeNull()
  })

  it('flags a subfolder of a project that has no convention of its own', async () => {
    await mkdir(join(root, '20-projects', 'plain', 'memory'), { recursive: true })

    const drift = await checkDrift(
      contextFor(everywhere),
      '20-projects/plain/memory/pnpm.md' as DocPath,
    )

    // The honest edge of nesting: the root document names 20-projects/{project}/
    // and no deeper, so a project that has not declared its own folders still
    // gets a drift note for creating one. Writing a content-structure.md in the
    // project answers it. A note, never a refusal.
    expect(drift?.reason).toBe('undeclared-folder')
  })

  it('still measures folders outside any project against the root document', async () => {
    const declared = await checkDrift(contextFor(everywhere), '05-memory/git.md' as DocPath)
    const undeclared = await checkDrift(contextFor(everywhere), '77-nowhere/thing.md' as DocPath)

    expect(declared).toBeNull()
    expect(undeclared?.reason).toBe('undeclared-folder')
  })
})
