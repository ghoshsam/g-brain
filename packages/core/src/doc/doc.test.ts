import { describe, expect, it } from 'vitest'
import type { Doc, DocMeta, DocPath } from '../types.js'
import { lint, parseDoc, stampMeta, stringifyDoc } from './index.js'

const p = (value: string): DocPath => value as DocPath

const meta = (overrides: Partial<DocMeta> = {}): DocMeta => ({
  path: p('10-knowledge/auth/oidc-token-refresh.md'),
  tags: [],
  extra: {},
  ...overrides,
})

const doc = (body: string, overrides: Partial<DocMeta> = {}): Doc => ({
  meta: meta(overrides),
  body,
  etag: 'etag-1',
})

const VALID = `---
title: OIDC token refresh
type: how-to
tags: [auth, oidc]
created: 2026-09-18
updated: 2026-09-18
---

Access tokens are refreshed by the gateway.
`

describe('parseDoc', () => {
  it('parses valid frontmatter onto DocMeta', () => {
    const { doc: parsed, findings } = parseDoc(p('10-knowledge/auth/oidc.md'), VALID, 'etag-1')

    expect(findings).toEqual([])
    expect(parsed.meta.title).toBe('OIDC token refresh')
    expect(parsed.meta.type).toBe('how-to')
    expect(parsed.meta.tags).toEqual(['auth', 'oidc'])
    expect(parsed.meta.created).toBe('2026-09-18')
    expect(parsed.meta.updated).toBe('2026-09-18')
    expect(parsed.meta.path).toBe('10-knowledge/auth/oidc.md')
    expect(parsed.etag).toBe('etag-1')
  })

  it('round-trips a valid document byte for byte', () => {
    const { doc: parsed } = parseDoc(p('10-knowledge/auth/oidc.md'), VALID, 'etag-1')
    expect(stringifyDoc(parsed)).toBe(VALID)
  })

  it('does not throw on malformed YAML and reports it as a finding', () => {
    const src = '---\ntitle: [unclosed\n---\n\nStill a document.\n'
    const { doc: parsed, findings } = parseDoc(p('00-inbox/note.md'), src, 'etag-1')

    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('malformed-frontmatter')
    expect(parsed.meta.title).toBeUndefined()
    expect(parsed.meta.tags).toEqual([])
    expect(parsed.meta.extra).toEqual({})
    expect(parsed.body).toBe(src)
    expect(stringifyDoc(parsed)).toBe(src)
  })

  it('parses a document with no frontmatter at all', () => {
    const src = '# Just a heading\n\nAnd a paragraph.\n'
    const { doc: parsed, findings } = parseDoc(p('00-inbox/note.md'), src, 'etag-1')

    expect(findings).toEqual([])
    expect(parsed.body).toBe(src)
    expect(parsed.meta.tags).toEqual([])
    expect(stringifyDoc(parsed)).toBe(src)
  })

  it('preserves unknown frontmatter keys across a round trip', () => {
    const src = `---
title: Gateway rotation
owner: sam
review:
  by: priya
  cadence: quarterly
---

Body.
`
    const { doc: parsed } = parseDoc(p('10-knowledge/gateway.md'), src, 'etag-1')

    expect(parsed.meta.extra.owner).toBe('sam')
    expect(parsed.meta.extra.review).toEqual({ by: 'priya', cadence: 'quarterly' })
    expect(stringifyDoc(parsed)).toBe(src)
  })

  it('does not reformat the body', () => {
    const body = '\nOne.   \n\n\n\tTabbed line\n\n```js\nconst a = 1\n```\n\n- item\n'
    const src = `---\ntitle: Shapes\n---${body}`
    const { doc: parsed } = parseDoc(p('10-knowledge/shapes.md'), src, 'etag-1')

    // Trailing spaces, blank runs, tabs and fences all survive untouched.
    // The newline right after the closing '---' belongs to the frontmatter
    // block, so gray-matter keeps it there — the round trip is what matters.
    expect(parsed.body).toBe(body.slice(1))
    expect(stringifyDoc(parsed)).toBe(src)
  })

  it('maps superseded-by and needs-filing in both directions', () => {
    const src = `---
title: Old approach
superseded-by: 40-decisions/2026/new-approach.md
needs-filing: true
---

Body.
`
    const { doc: parsed } = parseDoc(p('00-inbox/old.md'), src, 'etag-1')

    expect(parsed.meta.supersededBy).toBe('40-decisions/2026/new-approach.md')
    expect(parsed.meta.needsFiling).toBe(true)
    expect(parsed.meta.extra['superseded-by']).toBeUndefined()
    expect(stringifyDoc(parsed)).toBe(src)
  })

  it('keeps a known key with an unexpected shape rather than dropping it', () => {
    const src = '---\nstatus: mothballed\n---\n\nBody.\n'
    const { doc: parsed } = parseDoc(p('00-inbox/odd.md'), src, 'etag-1')

    expect(parsed.meta.status).toBeUndefined()
    expect(parsed.meta.extra.status).toBe('mothballed')
    expect(stringifyDoc(parsed)).toBe(src)
  })
})

describe('stampMeta', () => {
  it('stamps created, updated and id on a create', () => {
    const result = stampMeta(meta(), '2026-09-18', true)

    expect(result.stamped.sort()).toEqual(['created', 'id', 'updated'])
    expect(result.meta.created).toBe('2026-09-18')
    expect(result.meta.updated).toBe('2026-09-18')
    expect(result.meta.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('stamps only updated on a replace, preserving created and id', () => {
    const existing = meta({ created: '2020-01-01', id: 'fixed-id' })
    const result = stampMeta(existing, '2026-09-18', false)

    expect(result.stamped).toEqual(['updated'])
    expect(result.meta.created).toBe('2020-01-01')
    expect(result.meta.id).toBe('fixed-id')
    expect(result.meta.updated).toBe('2026-09-18')
  })

  it('overwrites updated whatever the caller sent', () => {
    const result = stampMeta(meta({ updated: '1999-01-01' }), '2026-09-18', false)
    expect(result.meta.updated).toBe('2026-09-18')
  })

  it('respects a caller-supplied created on a create', () => {
    const result = stampMeta(meta({ created: '2019-05-04' }), '2026-09-18', true)

    expect(result.meta.created).toBe('2019-05-04')
    expect(result.stamped).not.toContain('created')
  })

  it('does not mutate the meta it was given', () => {
    const original = meta()
    stampMeta(original, '2026-09-18', true)
    expect(original.updated).toBeUndefined()
    expect(original.id).toBeUndefined()
  })
})

describe('lint', () => {
  const rules = (d: Doc): string[] => lint(d).map((f) => f.rule)

  it('reports missing-title only when the title is absent or blank', () => {
    expect(rules(doc('Body.'))).toContain('missing-title')
    expect(rules(doc('Body.', { title: '   ' }))).toContain('missing-title')
    expect(rules(doc('Body.', { title: 'Present' }))).not.toContain('missing-title')
  })

  it('reports unknown-type only for a type outside the list', () => {
    expect(rules(doc('Body.', { type: 'blarg' }))).toContain('unknown-type')
    expect(rules(doc('Body.', { type: 'how-to' }))).not.toContain('unknown-type')
    expect(rules(doc('Body.', { type: 'incident' }))).not.toContain('unknown-type')
    expect(rules(doc('Body.'))).not.toContain('unknown-type')
  })

  it('reports filename-case only for a filename that is not kebab-case', () => {
    expect(rules(doc('Body.', { path: p('00-inbox/Meeting Notes.md') }))).toContain('filename-case')
    expect(rules(doc('Body.', { path: p('00-inbox/OIDC_notes.md') }))).toContain('filename-case')
    expect(
      rules(doc('Body.', { path: p('10-knowledge/auth/oidc-token-refresh.md') })),
    ).not.toContain('filename-case')
  })

  it('reports multiple-h1 with the line of the second heading', () => {
    const findings = lint(doc('# One\n\ntext\n\n# Two\n'))
    const finding = findings.find((f) => f.rule === 'multiple-h1')

    expect(finding?.line).toBe(5)
    expect(rules(doc('# One\n\n## Two\n'))).not.toContain('multiple-h1')
  })

  it('ignores a # inside a fenced code block', () => {
    const body = '# One\n\n```sh\n# a shell comment\n```\n\n~~~\n# another\n~~~\n'
    expect(rules(doc(body))).not.toContain('multiple-h1')
  })

  it('reports needs-filing-outside-inbox only outside the inbox', () => {
    expect(rules(doc('Body.', { needsFiling: true, path: p('10-knowledge/x.md') }))).toContain(
      'needs-filing-outside-inbox',
    )
    expect(rules(doc('Body.', { needsFiling: true, path: p('00-inbox/x.md') }))).not.toContain(
      'needs-filing-outside-inbox',
    )
    expect(rules(doc('Body.', { path: p('10-knowledge/x.md') }))).not.toContain(
      'needs-filing-outside-inbox',
    )
  })

  it('never rejects: a document with nothing but a body still lints to warnings', () => {
    expect(() => lint(doc(''))).not.toThrow()
  })
})
