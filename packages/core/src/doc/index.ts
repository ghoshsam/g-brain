import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import matter from 'gray-matter'
import type { Doc, DocMeta, DocPath, DocStatus, LintFinding } from '../types.js'

const KNOWN_TYPES = new Set([
  'concept',
  'how-to',
  'reference',
  'decision',
  'playbook',
  'note',
  'status',
  'meeting',
  'profile',
  'session',
  'memory',
  'spec',
  'incident',
])

/** Frontmatter keys that map onto a named DocMeta field. Everything else is extra. */
const KNOWN_KEYS = new Set([
  'title',
  'type',
  'tags',
  'created',
  'updated',
  'id',
  'status',
  'project',
  'repos',
  'source',
  'supersedes',
  'superseded-by',
  'needs-filing',
  'expires',
])

const STATUSES = new Set<string>(['draft', 'active', 'superseded'])

const KEBAB_MD = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const H1 = /^# \S/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

const isStatus = (value: unknown): value is DocStatus =>
  typeof value === 'string' && STATUSES.has(value)

const toText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

/** YAML resolves an unquoted 2026-09-18 to a Date; every date field is carried as text. */
const toDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return toText(value)
}

const toStringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
    else if (typeof item === 'number' || typeof item === 'boolean') out.push(String(item))
    else return undefined
  }
  return out
}

const emptyMeta = (path: DocPath): DocMeta => ({ path, tags: [], extra: {} })

function mapMeta(path: DocPath, data: Record<string, unknown>): DocMeta {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  /** A known key whose value is the wrong shape is kept verbatim rather than dropped. */
  const take = <T>(key: string, map: (value: unknown) => T | undefined): T | undefined => {
    if (!(key in data)) return undefined
    const mapped = map(data[key])
    if (mapped === undefined) extra[key] = data[key]
    return mapped
  }

  const title = take('title', toText)
  const type = take('type', toText)
  const tags = take('tags', toStringList)
  const created = take('created', toDate)
  const updated = take('updated', toDate)
  const id = take('id', toText)
  const status = take('status', (v) => (isStatus(v) ? v : undefined))
  const project = take('project', toText)
  const repos = take('repos', toStringList)
  const source = take('source', toText)
  const supersedes = take('supersedes', toText)
  const supersededBy = take('superseded-by', toText)
  const needsFiling = take('needs-filing', (v) => (typeof v === 'boolean' ? v : undefined))
  const expires = take('expires', toDate)

  return {
    path,
    tags: tags ?? [],
    extra,
    ...(title !== undefined && { title }),
    ...(type !== undefined && { type }),
    ...(created !== undefined && { created }),
    ...(updated !== undefined && { updated }),
    ...(id !== undefined && { id }),
    ...(status !== undefined && { status }),
    ...(project !== undefined && { project }),
    ...(repos !== undefined && { repos }),
    ...(source !== undefined && { source }),
    ...(supersedes !== undefined && { supersedes }),
    ...(supersededBy !== undefined && { supersededBy }),
    ...(needsFiling !== undefined && { needsFiling }),
    ...(expires !== undefined && { expires }),
  }
}

/** Never fails. Malformed frontmatter becomes a lint finding and an empty meta. */
export function parseDoc(
  path: DocPath,
  content: string,
  etag: string,
): { doc: Doc; findings: LintFinding[] } {
  try {
    const file = matter(content)
    const data: unknown = file.data
    if (isPlainObject(data)) {
      return { doc: { meta: mapMeta(path, data), body: file.content, etag }, findings: [] }
    }
  } catch {
    // Tolerated deliberately: an unparseable block is a finding, never a rejection.
  }
  return {
    doc: { meta: emptyMeta(path), body: content, etag },
    findings: [
      {
        rule: 'malformed-frontmatter',
        message:
          'The frontmatter block is not valid YAML, so it was stored unchanged and no fields were stamped. Fix the block between the --- markers and write again.',
        line: 1,
      },
    ],
  }
}

const needsQuoting = (value: string): boolean => {
  if (value === '') return true
  if (ISO_DATE.test(value)) return false
  if (value !== value.trim()) return true
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true
  if (value.includes(': ') || value.includes(' #')) return true
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)) return true
  return /^[+-]?\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(value)
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`

const isInlineScalar = (value: unknown): boolean =>
  (typeof value === 'string' && !value.includes('\n')) ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

const inlineScalar = (value: unknown): string => {
  if (typeof value === 'string') return needsQuoting(value) ? quote(value) : value
  return String(value)
}

/** Anything the inline emitter cannot express is handed back to gray-matter's YAML engine. */
const yamlBlock = (key: string, value: unknown): string => {
  const doc = matter.stringify('', { [key]: value })
  const start = doc.indexOf('\n') + 1
  const end = doc.lastIndexOf('\n---')
  return doc.slice(start, end === -1 ? undefined : end).replace(/\n+$/, '')
}

function emitEntry(key: string, value: unknown): string {
  if (isInlineScalar(value)) return `${key}: ${inlineScalar(value)}`
  if (value instanceof Date) return `${key}: ${value.toISOString().slice(0, 10)}`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`
    if (value.every(isInlineScalar)) return `${key}: [${value.map(inlineScalar).join(', ')}]`
  }
  return yamlBlock(key, value)
}

function frontmatterEntries(meta: DocMeta): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = []
  const push = (key: string, value: unknown): void => {
    if (value !== undefined) entries.push([key, value])
  }
  push('title', meta.title)
  push('type', meta.type)
  if (meta.tags.length > 0) push('tags', meta.tags)
  push('created', meta.created)
  push('updated', meta.updated)
  push('id', meta.id)
  push('status', meta.status)
  push('project', meta.project)
  push('repos', meta.repos)
  push('source', meta.source)
  push('supersedes', meta.supersedes)
  push('superseded-by', meta.supersededBy)
  push('needs-filing', meta.needsFiling)
  push('expires', meta.expires)
  for (const [key, value] of Object.entries(meta.extra)) push(key, value)
  return entries
}

export function stringifyDoc(doc: Doc): string {
  const entries = frontmatterEntries(doc.meta)
  if (entries.length === 0) return doc.body
  const block = entries.map(([key, value]) => emitEntry(key, value)).join('\n')
  return `---\n${block}\n---\n${doc.body}`
}

/** Returns the stamped meta plus which fields were added. */
export function stampMeta(
  meta: DocMeta,
  now: string,
  isCreate: boolean,
): { meta: DocMeta; stamped: string[] } {
  const stamped: string[] = []
  const next: DocMeta = { ...meta }

  if (isCreate && next.created === undefined) {
    next.created = now
    stamped.push('created')
  }

  next.updated = now
  stamped.push('updated')

  if (isCreate && next.id === undefined) {
    next.id = randomUUID()
    stamped.push('id')
  }

  return { meta: next, stamped }
}

/** 1-based line numbers, relative to the body, of `# ` headings outside fenced code blocks. */
function h1Lines(body: string): number[] {
  const lines = body.split('\n')
  const found: number[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const marker = FENCE.exec(line)?.[1]
    if (fence === null) {
      if (marker !== undefined) {
        fence = marker
        continue
      }
      if (H1.test(line)) found.push(i + 1)
    } else if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null
    }
  }
  return found
}

const isInInbox = (path: DocPath): boolean => {
  const first = path.split('/')[0] ?? ''
  return first.replace(/^\d+-/, '') === 'inbox'
}

export function lint(doc: Doc): LintFinding[] {
  const findings: LintFinding[] = []
  const { meta, body } = doc

  if (meta.title === undefined || meta.title.trim() === '') {
    findings.push({
      rule: 'missing-title',
      message:
        'This document has no title. Add a title: line to the frontmatter saying what it is, in a human sentence.',
    })
  }

  if (meta.type !== undefined && !KNOWN_TYPES.has(meta.type)) {
    findings.push({
      rule: 'unknown-type',
      message: `"${meta.type}" is not one of the types this brain uses (${[...KNOWN_TYPES].join(', ')}). Pick the closest one, or add the new type to content-structure.md first.`,
    })
  }

  const filename = posix.basename(meta.path)
  if (!KEBAB_MD.test(filename)) {
    findings.push({
      rule: 'filename-case',
      message: `"${filename}" is not lowercase kebab-case. Rename it to words separated by single hyphens, ending in .md.`,
    })
  }

  const headings = h1Lines(body)
  const second = headings[1]
  if (second !== undefined) {
    findings.push({
      rule: 'multiple-h1',
      message:
        'This document has more than one top-level heading. Keep one "# " heading and demote the rest to "## ".',
      line: second,
    })
  }

  if (meta.needsFiling === true && !isInInbox(meta.path)) {
    findings.push({
      rule: 'needs-filing-outside-inbox',
      message:
        'needs-filing: true is set on a document that is already filed. Remove the field, or move the document back to the inbox folder.',
    })
  }

  return findings
}
