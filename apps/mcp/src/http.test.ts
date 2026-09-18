import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROFILES, generateKey, loadConfig } from '@g-brain/core'
import type { BrainConfig } from '@g-brain/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startHttp } from './http.js'

let root: string
let server: Awaited<ReturnType<typeof startHttp>>
let base: string

// A port unlikely to collide with anything the developer is running.
let nextPort = 18_900

const configFor = (brainRoot: string, overrides: Partial<BrainConfig> = {}): BrainConfig => ({
  ...loadConfig({ BRAIN_ROOT: brainRoot, MCP_TRANSPORT: 'http' }),
  brainRoot,
  mcpHttpPort: nextPort++,
  ...overrides,
})

const call = async (path: string, init: RequestInit = {}) => await fetch(`${base}${path}`, init)

const mcpRequest = async (key: string | null, body: unknown) =>
  await call('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(key === null ? {} : { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify(body),
  })

const start = async (overrides: Partial<BrainConfig> = {}) => {
  const config = configFor(root, overrides)
  server = await startHttp(config)
  base = `http://127.0.0.1:${config.mcpHttpPort}`
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gbrain-http-'))
  await writeFile(
    join(root, 'content-structure.md'),
    '# Structure\n\n## 00-inbox/\n\nUnplaced.\n\n## 10-knowledge/\n\nDurable.\n',
    'utf8',
  )
})

afterEach(async () => {
  await server?.close()
  await rm(root, { recursive: true, force: true })
})

describe('GET /health', () => {
  it('answers without a key, so a deployment probe can use it', async () => {
    await start({ authRequired: true })

    const response = await call('/health')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      status: string
      brainRoot: string
      index: unknown
      autocommit: boolean
    }
    expect(body.status).toBe('ok')
    expect(body.brainRoot).toBe(root)
    expect(body.index).toBeDefined()
    expect(body.autocommit).toBe(false)
  })
})

describe('authentication', () => {
  it('refuses a request with no key when the brain requires one', async () => {
    await start({ authRequired: true })

    const response = await mcpRequest(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(response.status).toBe(401)

    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('refuses a key the brain does not know', async () => {
    await start({ authRequired: true })

    const response = await mcpRequest('gbk_not-a-real-key', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    expect(response.status).toBe(401)
  })

  it('accepts a generated key', async () => {
    const created = await generateKey(root, 'capture', DEFAULT_PROFILES.capture ?? [])
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await start({ authRequired: true })

    const response = await mcpRequest(created.value.key, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    })

    expect(response.status).toBe(200)
  })

  it('stores only the hash, never the key', async () => {
    const created = await generateKey(root, 'capture', DEFAULT_PROFILES.capture ?? [])
    if (!created.ok) return

    const { readFile } = await import('node:fs/promises')
    const stored = await readFile(join(root, '.brain', 'agents.json'), 'utf8')

    expect(stored).not.toContain(created.value.key)
    expect(stored).toContain('hash')
  })
})

describe('routing', () => {
  it('has no endpoint other than /health and /mcp', async () => {
    await start()
    expect((await call('/')).status).toBe(404)
    expect((await call('/docs')).status).toBe(404)
  })
})

describe('the default key profiles', () => {
  it('gives the recall agent read everywhere and write nowhere', () => {
    const recall = DEFAULT_PROFILES.recall ?? []
    expect(recall.every((scope) => scope.write === false)).toBe(true)
    expect(recall.some((scope) => scope.folder === '' && scope.read)).toBe(true)
  })

  it('does not let the capture profile write to the archive', () => {
    const capture = DEFAULT_PROFILES.capture ?? []
    const writable = capture.filter((scope) => scope.write).map((scope) => scope.folder)

    // Archiving stays a curation action, so it is always attributable to a run
    // somebody approved.
    expect(writable).not.toContain('90-archive')
    expect(writable).not.toContain('')
  })
})
