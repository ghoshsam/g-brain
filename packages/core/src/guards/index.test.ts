import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noopAudit, noopGit, noopSearch } from '../ports.js'
import type { BrainConfig, BrainContext, DocPath, SearchHit, SearchPort } from '../types.js'
import { checkDuplicate, checkRate, checkSize, resetRateLimits, scanSecrets } from './index.js'

const baseConfig: BrainConfig = {
  brainRoot: '',
  gitAutocommit: false,
  gitAuthorSuffix: '',
  gitDebounceMs: 0,
  mcpTransport: 'stdio',
  mcpHttpPort: 8787,
  authRequired: false,
  maxDocBytes: 262_144,
  rateLimitPerMinute: 120,
  auditMaxBytes: 1_048_576,
  auditKeep: 3,
  duplicateThreshold: 0.9,
  searchMode: 'lexical',
  sessionExpiryDays: 30,
}

const makeCtx = (
  root: string,
  config: Partial<BrainConfig> = {},
  actorId = 'test-actor',
): BrainContext => ({
  root,
  config: { ...baseConfig, brainRoot: root, ...config },
  actor: { id: actorId, name: actorId, scopes: [{ folder: '', read: true, write: true }] },
  git: noopGit,
  audit: noopAudit,
  search: noopSearch,
})

// These have to look like the real thing, or the rules are not really tested.
// But a realistic literal in a source file is indistinguishable from a leaked
// credential — GitHub's push protection blocked this repository over exactly
// these lines, and it was right to.
//
// So each value is assembled at run time. Our rules see the finished string and
// are tested honestly; no scanner, ours or anyone else's, ever sees a complete
// credential in the source.
const make = (...parts: string[]): string => parts.join('')

const FAKES: Record<string, string> = {
  'private-key-block': make('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'),
  'aws-access-key-id': make('AKIA', '3XJQ7KZ', 'P2RMTVB4C'),
  'github-token': make('ghp_', 'A1b2C3d4E5f6G7h8', 'I9j0K1l2M3n4O5p6Q7r8'),
  'github-fine-grained-token': make('github_pat_', '11ABCDEFG0aBcDeFgHi', 'JkLmNoPqRsTuVwXyZ'),
  'slack-token': make('xoxb-', '2481632-9876543210-', 'Ab12Cd34Ef56Gh78Ij90Kl12'),
  'stripe-secret-key': make('sk_live_', '51H8Kq2LmNp', 'QrStUvWxYz0123'),
  'google-api-key': make('AIza', 'SyB1c3D5e7G9h1J3k5', 'L7m9N1p3Q5r7S9t1U'),
  'anthropic-api-key': make('sk-ant-', 'api03-Ab1Cd2Ef3Gh4Ij5', 'Kl6Mn7Op8Qr9St0Uv'),
  'openai-api-key': make('sk-proj-', 'Ab1Cd2Ef3Gh4', 'Ij5Kl6Mn7Op8Qr9St0'),
  'npm-token': make('npm_', 'Z9y8X7w6V5u4T3s2', 'R1q0P9o8N7m6L5k4J3i2'),
  'json-web-token': make(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
    'eyJzdWIiOiI5OTkiLCJuYW1lIjoiYSJ9.',
    'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  ),
}

const scanRules = (body: string): string[] => scanSecrets(body).map((finding) => finding.rule)

describe('scanSecrets', () => {
  it('detects each secret family it claims to cover', () => {
    for (const [rule, value] of Object.entries(FAKES)) {
      expect(scanRules(`the value is ${value} and that is that`), rule).toContain(rule)
    }
  })

  it('detects a PEM block of every key type', () => {
    for (const marker of [
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    ]) {
      expect(scanRules(marker), marker).toContain('private-key-block')
    }
  })

  it('detects an AWS secret access key in assignment position', () => {
    const body = `aws_secret_access_key = ${make('hQ8fR2pLxV3nCz9W', 'kT6yB1mJ4dS7uA0eG5iN2oQr')}`
    expect(scanRules(body)).toContain('aws-secret-access-key')
  })

  it('detects a bearer token in an Authorization header', () => {
    const body = 'Authorization: Bearer Kj8Hx2Lp9Qw4Zr7Tn1Vb5Yc3Mf6Gd0Sa'
    expect(scanRules(body)).toContain('authorization-bearer-token')
  })

  it('detects connection strings that carry credentials', () => {
    expect(scanRules('postgres://svc:hunter2horse@db.internal:5432/billing')).toContain(
      'postgres-connection-string',
    )
    expect(scanRules('mongodb+srv://appuser:s3cr3tP4ss@cluster0.abcde.mongodb.net/prod')).toContain(
      'mongodb-connection-string',
    )
    expect(scanRules('mysql://root:tr0ub4dor@10.0.0.4:3306/app')).toContain(
      'mysql-connection-string',
    )
    expect(scanRules('redis://:aVeryLongRedisPassword@cache.internal:6379/0')).toContain(
      'redis-connection-string',
    )
  })

  it('detects a high-entropy value in assignment position', () => {
    const body = 'client_secret = "Kj8Hx2Lp9Qw4Zr7Tn1Vb5Yc3Mf6Gd0Sa"'
    expect(scanRules(body)).toContain('generic-high-entropy-assignment')
  })

  it('reports the 1-based line the secret is on', () => {
    const body = [
      '# Runbook',
      '',
      'first line of prose',
      `key: ${FAKES['aws-access-key-id']}`,
    ].join('\n')
    const findings = scanSecrets(body)
    expect(findings[0]?.line).toBe(4)
  })

  it('never puts the secret in the finding', () => {
    for (const value of Object.values(FAKES)) {
      const body = `context before ${value} context after`
      for (const finding of scanSecrets(body)) {
        expect(JSON.stringify(finding), value).not.toContain(value)
        expect(finding.excerpt).toContain('[redacted]')
      }
    }
  })

  it('leaves no long token in the excerpt even when the line carries two', () => {
    const body = `token: ${FAKES['github-token']} backup: ${FAKES['npm-token']}`
    for (const finding of scanSecrets(body)) {
      expect(finding.excerpt).not.toContain(FAKES['github-token'] as string)
      expect(finding.excerpt).not.toContain(FAKES['npm-token'] as string)
    }
  })

  it('does not flag a document that talks about secrets without carrying one', () => {
    const body = [
      '# Rotating credentials',
      '',
      'Rotate the AWS access key id and the secret access key every 90 days.',
      'An access key id starts with AKIA... and a GitHub token starts with ghp_ ',
      'followed by thirty-six characters. Paste neither into this brain.',
      '',
      'See also: https://example.com/runbooks/rotation and the 90-day reminder.',
    ].join('\n')
    expect(scanSecrets(body)).toEqual([])
  })

  it('does not flag AWS documentation example keys', () => {
    expect(scanRules('AKIAIOSFODNN7EXAMPLE')).toEqual([])
  })

  it('does not flag a uuid or a git sha in assignment position', () => {
    const body = [
      'id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'commit: 9f2c1a7b3d4e5f60718293a4b5c6d7e8f9012345',
    ].join('\n')
    expect(scanRules(body)).toEqual([])
  })
})

describe('checkSize', () => {
  it('measures bytes, not characters', () => {
    const ctx = makeCtx('/nowhere', { maxDocBytes: 150 })
    const multiByte = 'é'.repeat(100)
    expect(multiByte.length).toBe(100)
    const result = checkSize(ctx, multiByte)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TOO_LARGE')
      expect(result.error.details?.bytes).toBe(200)
    }
  })

  it('accepts a document at the ceiling', () => {
    const ctx = makeCtx('/nowhere', { maxDocBytes: 10 })
    expect(checkSize(ctx, '0123456789').ok).toBe(true)
    expect(checkSize(ctx, '01234567890').ok).toBe(false)
  })
})

describe('checkRate', () => {
  beforeEach(() => {
    resetRateLimits()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetRateLimits()
  })

  it('trips at the limit and recovers once the bucket refills', () => {
    const ctx = makeCtx('/nowhere', { rateLimitPerMinute: 3 }, 'busy-agent')
    expect(checkRate(ctx).ok).toBe(true)
    expect(checkRate(ctx).ok).toBe(true)
    expect(checkRate(ctx).ok).toBe(true)

    const tripped = checkRate(ctx)
    expect(tripped.ok).toBe(false)
    if (!tripped.ok) {
      expect(tripped.error.code).toBe('RATE_LIMITED')
      expect(tripped.error.details?.retryAfterSeconds).toBeGreaterThan(0)
    }

    vi.advanceTimersByTime(60_000)
    expect(checkRate(ctx).ok).toBe(true)
  })

  it('meters each actor separately', () => {
    const one = makeCtx('/nowhere', { rateLimitPerMinute: 1 }, 'agent-one')
    const two = makeCtx('/nowhere', { rateLimitPerMinute: 1 }, 'agent-two')
    expect(checkRate(one).ok).toBe(true)
    expect(checkRate(one).ok).toBe(false)
    expect(checkRate(two).ok).toBe(true)
  })

  it('does not meter when the limit is off', () => {
    const ctx = makeCtx('/nowhere', { rateLimitPerMinute: 0 }, 'unmetered')
    for (let index = 0; index < 50; index += 1) expect(checkRate(ctx).ok).toBe(true)
  })
})

describe('checkDuplicate', () => {
  let root: string
  const folder = path.join('10-knowledge', 'auth')
  const existingPath = '10-knowledge/auth/oidc-token-refresh.md'
  const existingBody = [
    'The refresh token is exchanged at the token endpoint, and the identity provider',
    'returns a new access token plus a rotated refresh token. Store neither in the brain.',
    'When the rotation fails the client falls back to a full authorisation code flow.',
  ].join('\n')

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'gbrain-guards-'))
    await mkdir(path.join(root, folder), { recursive: true })
    await writeFile(
      path.join(root, folder, 'oidc-token-refresh.md'),
      `---\ntitle: OIDC token refresh\n---\n\n${existingBody}\n`,
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('conflicts on a near-identical body and names the existing path', async () => {
    const ctx = makeCtx(root)
    const nearly = `${existingBody}\n`
    const result = await checkDuplicate(
      ctx,
      '10-knowledge/auth/refresh.md' as DocPath,
      nearly,
      false,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.details?.existingPath).toBe(existingPath)
      expect(result.error.details?.similarity).toBeGreaterThanOrEqual(0.9)
      expect(result.error.message).toContain(existingPath)
    }
  })

  it('is bypassed by force', async () => {
    const ctx = makeCtx(root)
    const result = await checkDuplicate(
      ctx,
      '10-knowledge/auth/refresh.md' as DocPath,
      existingBody,
      true,
    )
    expect(result.ok).toBe(true)
  })

  it('does not conflict on a different body', async () => {
    const ctx = makeCtx(root)
    const result = await checkDuplicate(
      ctx,
      '10-knowledge/auth/scim.md' as DocPath,
      'SCIM provisioning pushes users from the directory into the application nightly.',
      false,
    )
    expect(result.ok).toBe(true)
  })

  it('does not conflict a document with itself', async () => {
    const ctx = makeCtx(root)
    const result = await checkDuplicate(ctx, existingPath as DocPath, existingBody, false)
    expect(result.ok).toBe(true)
  })

  it('ignores documents in other folders', async () => {
    await mkdir(path.join(root, '00-inbox'), { recursive: true })
    const ctx = makeCtx(root)
    const result = await checkDuplicate(ctx, '00-inbox/note.md' as DocPath, existingBody, false)
    expect(result.ok).toBe(true)
  })

  it('uses the search port when it returns candidates', async () => {
    const hit: SearchHit = { path: existingPath as DocPath, snippet: '', score: 1 }
    const search: SearchPort = { ...noopSearch, similar: async () => [hit] }
    const ctx: BrainContext = { ...makeCtx(root), search }
    const result = await checkDuplicate(
      ctx,
      '10-knowledge/auth/refresh.md' as DocPath,
      existingBody,
      false,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details?.existingPath).toBe(existingPath)
  })

  it('passes an empty body rather than comparing nothing', async () => {
    const ctx = makeCtx(root)
    expect((await checkDuplicate(ctx, '10-knowledge/auth/x.md' as DocPath, '  ', false)).ok).toBe(
      true,
    )
  })
})
