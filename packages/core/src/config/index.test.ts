import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertSafeBrainRoot, loadConfig } from './index.js'

const fold = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)

describe('loadConfig', () => {
  it('applies every documented default when the environment is empty', () => {
    const config = loadConfig({})

    expect(config.gitAutocommit).toBe(false)
    expect(config.gitAuthorSuffix).toBe('@g-brain.local')
    expect(config.gitDebounceMs).toBe(2000)
    expect(config.mcpTransport).toBe('stdio')
    expect(config.mcpHttpPort).toBe(8787)
    expect(config.maxDocBytes).toBe(262144)
    expect(config.rateLimitPerMinute).toBe(120)
    expect(config.auditMaxBytes).toBe(8388608)
    expect(config.auditKeep).toBe(8)
    expect(config.duplicateThreshold).toBe(0.9)
    expect(config.searchMode).toBe('lexical')
    expect(config.sessionExpiryDays).toBe(90)
  })

  it('anchors the default brain root to $HOME, never to cwd', () => {
    const config = loadConfig({})

    expect(isAbsolute(config.brainRoot)).toBe(true)
    expect(basename(config.brainRoot)).toBe('brain')
    expect(fold(config.brainRoot).startsWith(fold(realpathSync(homedir())))).toBe(true)
    expect(fold(config.brainRoot)).not.toBe(fold(join(process.cwd(), 'brain')))
  })

  it('expands a leading tilde against the home directory', () => {
    const config = loadConfig({ BRAIN_ROOT: '~/g-brain-tilde-fixture' })

    expect(config.brainRoot).toBe(join(realpathSync(homedir()), 'g-brain-tilde-fixture'))
    expect(config.brainRoot).not.toContain('~')
  })

  it('resolves a relative brain root to an absolute path', () => {
    const config = loadConfig({ BRAIN_ROOT: './fixture-brain' })

    expect(isAbsolute(config.brainRoot)).toBe(true)
  })

  it('rejects an invalid numeric value and names the variable', () => {
    expect(() => loadConfig({ GIT_DEBOUNCE_MS: 'soon' })).toThrow(/GIT_DEBOUNCE_MS/)
    expect(() => loadConfig({ MCP_HTTP_PORT: '99999' })).toThrow(/MCP_HTTP_PORT/)
    expect(() => loadConfig({ DUPLICATE_THRESHOLD: '1.5' })).toThrow(/DUPLICATE_THRESHOLD/)
  })

  it('rejects an unknown transport and an unknown search mode', () => {
    expect(() => loadConfig({ MCP_TRANSPORT: 'grpc' })).toThrow(/MCP_TRANSPORT/)
    expect(() => loadConfig({ SEARCH_MODE: 'hybrid' })).toThrow(/SEARCH_MODE/)
  })

  it('defaults AUTH_REQUIRED per transport', () => {
    expect(loadConfig({}).authRequired).toBe(false)
    expect(loadConfig({ MCP_TRANSPORT: 'stdio' }).authRequired).toBe(false)
    expect(loadConfig({ MCP_TRANSPORT: 'http' }).authRequired).toBe(true)
  })

  it('lets an explicit AUTH_REQUIRED override the transport default', () => {
    expect(loadConfig({ MCP_TRANSPORT: 'http', AUTH_REQUIRED: 'false' }).authRequired).toBe(false)
    expect(loadConfig({ MCP_TRANSPORT: 'stdio', AUTH_REQUIRED: 'true' }).authRequired).toBe(true)
  })

  it('treats a blank variable as unset', () => {
    expect(loadConfig({ MCP_TRANSPORT: 'http', AUTH_REQUIRED: '' }).authRequired).toBe(true)
    expect(loadConfig({ BRAIN_ROOT: '' }).brainRoot).toBe(loadConfig({}).brainRoot)
  })

  it('returns a frozen config', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true)
  })
})

describe('assertSafeBrainRoot', () => {
  let tmp = ''

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'g-brain-config-'))
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('refuses a brain root inside another git repository', async () => {
    const repo = join(tmp, 'project')
    const brain = join(repo, 'seed', 'brain')
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(brain, { recursive: true })

    const result = assertSafeBrainRoot(brain)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_PATH')
    expect(result.error.message).toContain('BRAIN_ROOT')
    expect(result.error.message).toContain('GIT_AUTOCOMMIT')
    expect(result.error.details?.repoRoot).toBe(realpathSync(repo))
  })

  it('accepts a brain root that is its own repository', async () => {
    const brain = join(tmp, 'own-repo-brain')
    await mkdir(join(brain, '.git'), { recursive: true })

    expect(assertSafeBrainRoot(brain).ok).toBe(true)
  })

  it('accepts a brain root with no repository above it', async () => {
    const brain = join(tmp, 'plain-brain')
    await mkdir(brain, { recursive: true })

    expect(assertSafeBrainRoot(brain).ok).toBe(true)
  })

  it('accepts a brain root that does not exist yet', () => {
    expect(assertSafeBrainRoot(join(tmp, 'not-created-yet')).ok).toBe(true)
  })
})
