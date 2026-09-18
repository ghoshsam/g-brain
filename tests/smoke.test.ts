import { describe, expect, it } from 'vitest'
import { EXIT_CODES } from '../apps/cli/src/index.js'
import { errorCodeOf, textOf, toToolResult } from '../apps/mcp/src/index.js'
import { err, isOk, noopAudit, noopGit, noopSearch, ok } from '../packages/core/src/index.js'
import { ARCHIVE_RANK_PENALTY } from '../packages/search/src/index.js'

describe('core loads', () => {
  it('ok carries the value', () => {
    const r = ok(42)
    expect(isOk(r)).toBe(true)
    expect(r.ok && r.value).toBe(42)
  })

  it('err carries the code and omits absent details', () => {
    const r = err('NOT_FOUND', 'no document there')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.code).toBe('NOT_FOUND')
    expect(!r.ok && 'details' in r.error).toBe(false)
  })

  it('err carries details when given', () => {
    const r = err('PRECONDITION_FAILED', 'stale etag', { etag: 'E2' })
    expect(!r.ok && r.error.details).toEqual({ etag: 'E2' })
  })

  it('ports are inert and never throw', async () => {
    noopGit.recordWrite('a.md' as never, { id: 'local', name: 'local', scopes: [] }, 'write')
    noopAudit.record({
      ts: '2026-09-18T00:00:00Z',
      actor: 'local',
      action: 'write',
      path: 'a.md',
      outcome: 'ok',
    })
    noopSearch.onWrite('a.md' as never)
    expect(await noopSearch.rebuild()).toEqual({ ok: true, value: { documents: 0 } })
    expect(noopSearch.freshness().stale).toBe(true)
  })
})

describe('surfaces are mappings', () => {
  it('mcp maps a success', () => {
    const mapped = toToolResult(ok({ etag: 'E1' }))
    expect(mapped.isError).toBeUndefined()
    expect(textOf(mapped)).toContain('E1')
  })

  it('mcp carries the code so an agent can branch on it', () => {
    const mapped = toToolResult(err('CONFLICT', 'near-duplicate', { existingPath: 'x.md' }))
    expect(mapped.isError).toBe(true)
    expect(errorCodeOf(mapped)).toBe('CONFLICT')
    expect(textOf(mapped)).toContain('x.md')
  })

  it('every error code has a distinct exit code', () => {
    const codes = Object.values(EXIT_CODES)
    expect(new Set(codes).size).toBe(codes.length)
    expect(EXIT_CODES.OK).toBe(0)
  })
})

describe('search loads', () => {
  it('archive is penalised, not excluded', () => {
    expect(ARCHIVE_RANK_PENALTY).toBeGreaterThan(0)
    expect(ARCHIVE_RANK_PENALTY).toBeLessThan(1)
  })
})
