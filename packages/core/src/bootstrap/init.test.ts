import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initBrain, listPresets, mcpSnippet } from './init.js'

const run = promisify(execFile)

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'gbrain-init-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('listPresets', () => {
  it('discovers presets from files, with no code change needed', async () => {
    const presets = await listPresets()
    const names = presets.map((p) => p.name)

    expect(names).toContain('default')
    expect(names).toContain('personal')
    expect(names).toContain('product-team')
    expect(presets.every((p) => p.summary.length > 0)).toBe(true)
  })
})

describe('initBrain', () => {
  it('creates a working brain', async () => {
    const target = join(workspace, 'brain')
    const result = await initBrain({ dir: target })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.preset).toBe('default')
    expect(result.value.seededDocuments).toBeGreaterThan(0)

    const structure = await readFile(join(target, 'content-structure.md'), 'utf8')
    expect(structure).toContain('00-inbox/')

    const readme = await readFile(join(target, 'README.md'), 'utf8')
    expect(readme).toContain('mcpServers')

    // .brain/ is derived state — it should never reach the repo.
    const ignore = await readFile(join(target, '.gitignore'), 'utf8')
    expect(ignore).toContain('.brain/')
  })

  it('writes the structure document byte for byte from the chosen preset', async () => {
    const target = join(workspace, 'personal-brain')
    await initBrain({ dir: target, preset: 'personal' })

    const presets = await listPresets()
    const personal = presets.find((p) => p.name === 'personal')
    const written = await readFile(join(target, 'content-structure.md'), 'utf8')

    expect(written).toBe(personal?.markdown)
  })

  it('makes the brain its own git repository', async () => {
    const target = join(workspace, 'brain')
    const result = await initBrain({ dir: target })

    if (!result.ok) return
    if (!result.value.gitInitialised) return // git not installed on this machine

    const entries = await readdir(target)
    expect(entries).toContain('.git')
  })

  it('refuses a directory that already has content', async () => {
    const target = join(workspace, 'occupied')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'something.txt'), 'mine', 'utf8')

    const result = await initBrain({ dir: target })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONFLICT')
  })

  it('writes into an occupied directory when forced', async () => {
    const target = join(workspace, 'occupied')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'something.txt'), 'mine', 'utf8')

    const result = await initBrain({ dir: target, force: true })
    expect(result.ok).toBe(true)
  })

  it('names the presets that exist when asked for one that does not', async () => {
    const result = await initBrain({ dir: join(workspace, 'brain'), preset: 'nonsense' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toContain('default')
    }
  })

  it('refuses to create a brain inside someone else’s git repo', async () => {
    // The accident this exists to prevent: with auto-commit on, an agent's
    // captures would land in that project's working tree.
    const repo = join(workspace, 'some-project')
    await mkdir(repo, { recursive: true })
    try {
      await run('git', ['init', '--quiet'], { cwd: repo })
    } catch {
      return // git not installed
    }

    const result = await initBrain({ dir: join(repo, 'docs', 'brain') })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_PATH')
  })
})

describe('mcpSnippet', () => {
  it('uses forward slashes so it pastes into JSON on any platform', () => {
    const snippet = mcpSnippet('C:\\Users\\sam\\brain')
    expect(snippet).toContain('C:/Users/sam/brain')
    expect(snippet).not.toContain('\\\\')
    expect(() => JSON.parse(snippet)).not.toThrow()
  })
})
