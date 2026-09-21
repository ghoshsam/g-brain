import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noopGit, noopSearch } from '../ports.js'
import { getTree } from '../structure/index.js'
import type { Actor, AuditPort, BrainConfig, BrainContext } from '../types.js'
import { listProjects } from './index.js'

const STRUCTURE = `# Content Structure

## 10-knowledge/{topic}/

Durable reference.

## 20-projects/{project}/

Everything scoped to one active piece of work.
`

const config = (root: string, overrides: Partial<BrainConfig> = {}): BrainConfig => ({
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
  ...overrides,
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

const contextFor = (actor: Actor, overrides: Partial<BrainConfig> = {}): BrainContext => ({
  root,
  config: config(root, overrides),
  actor,
  git: noopGit,
  audit: silentAudit,
  search: noopSearch,
})

const doc = (title: string) => `---\ntitle: ${title}\ntype: note\n---\n\nBody.\n`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-projects-'))
  await writeFile(join(root, 'content-structure.md'), STRUCTURE, 'utf8')

  await mkdir(join(root, '20-projects', 'billing'), { recursive: true })
  await mkdir(join(root, '20-projects', 'acquisition'), { recursive: true })
  await mkdir(join(root, '10-knowledge', 'auth'), { recursive: true })

  await writeFile(join(root, '20-projects', 'billing', 'notes.md'), doc('Billing notes'), 'utf8')
  await writeFile(join(root, '20-projects', 'acquisition', 'plan.md'), doc('Plan'), 'utf8')
  await writeFile(join(root, '10-knowledge', 'auth', 'tokens.md'), doc('Tokens'), 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('listProjects', () => {
  it('returns the directories under the projects folder', async () => {
    const result = await listProjects(contextFor(everywhere))
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value.map((p) => p.project)).toEqual(['acquisition', 'billing'])
  })

  it('omits a project the actor cannot read, rather than marking it withheld', async () => {
    const result = await listProjects(contextFor(onlyBilling))
    if (!result.ok) throw new Error(result.error.code)

    // Absent, not disabled. Naming it at all would hand back the shape of the
    // brain that core/auth deliberately withholds.
    expect(result.value.map((p) => p.project)).toEqual(['billing'])
    expect(JSON.stringify(result.value)).not.toContain('acquisition')
  })

  it('reads the linked repositories from the project README, when there is one', async () => {
    await writeFile(
      join(root, '20-projects', 'billing', 'README.md'),
      '---\ntitle: Billing\ntype: reference\nrepos: [acme/billing-svc]\n---\n\nAbout.\n',
      'utf8',
    )

    const result = await listProjects(contextFor(everywhere))
    if (!result.ok) throw new Error(result.error.code)

    const billing = result.value.find((p) => p.project === 'billing')
    expect(billing?.repos).toEqual(['acme/billing-svc'])
  })

  it('leaves repos undefined for a project that maps to none', async () => {
    const result = await listProjects(contextFor(everywhere))
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value.find((p) => p.project === 'acquisition')?.repos).toBeUndefined()
  })

  it('finds projects under a renamed folder, so a preset can call it something else', async () => {
    await mkdir(join(root, 'projects', 'garden'), { recursive: true })
    await writeFile(join(root, 'projects', 'garden', 'beds.md'), doc('Beds'), 'utf8')

    const result = await listProjects(contextFor(everywhere, { projectsFolder: 'projects' }))
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value.map((p) => p.project)).toEqual(['garden'])
  })

  it('is empty, not an error, when the projects folder does not exist', async () => {
    const result = await listProjects(contextFor(everywhere, { projectsFolder: 'nothing-here' }))
    if (!result.ok) throw new Error(result.error.code)

    expect(result.value).toEqual([])
  })
})

describe('getTree respects read scopes', () => {
  it('shows a narrow actor only the folders it may read', async () => {
    const result = await getTree(contextFor(onlyBilling))
    if (!result.ok) throw new Error(result.error.code)

    // The whole point: a folder name is itself information. A key scoped to one
    // project must not learn that the others exist, or what is in them.
    const rendered = JSON.stringify(result.value)
    expect(rendered).not.toContain('acquisition')
    expect(rendered).not.toContain('10-knowledge')
    expect(rendered).toContain('billing')
  })

  it('shows an unrestricted actor everything', async () => {
    const result = await getTree(contextFor(everywhere))
    if (!result.ok) throw new Error(result.error.code)

    const rendered = JSON.stringify(result.value)
    expect(rendered).toContain('acquisition')
    expect(rendered).toContain('10-knowledge')
  })
})
