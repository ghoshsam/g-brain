import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { DocPath, Result, SearchHit, SearchPort, SearchQuery } from '@g-brain/core'
import { ok } from '@g-brain/core'
import { create, insertMultiple, search as oramaSearch, remove } from '@orama/orama'
import type { AnyOrama } from '@orama/orama'
import { watch } from 'chokidar'
import fg from 'fast-glob'
import matter from 'gray-matter'

/**
 * Archived content loses to live content but is never excluded. Excluding it
 * would make superseded decisions invisible, and reading what was believed at
 * the time is half the reason they are kept.
 */
export const ARCHIVE_RANK_PENALTY = 0.3

const SCHEMA = {
  path: 'string',
  title: 'string',
  headings: 'string',
  tags: 'string[]',
  type: 'string',
  status: 'string',
  updated: 'string',
  folder: 'string',
  body: 'string',
} as const

// Where a term appears says more than how often. A query matching a title is
// almost always a better hit than the same query buried in a body.
const FIELD_WEIGHTS = { title: 4, headings: 2.5, tags: 2, body: 1 }

interface IndexedDocument {
  path: string
  title: string
  headings: string
  tags: string[]
  type: string
  status: string
  updated: string
  folder: string
  body: string
}

export interface SearchOptions {
  /** Keep the index fresh as files change. Off for one-shot commands. */
  watch?: boolean
  debounceMs?: number
}

export type ClosableSearchPort = SearchPort & {
  /** Stop watching. A watcher that outlives its brain keeps a handle on a
   *  directory that may since have been deleted. */
  close(): Promise<void>
}

export function createSearchPort(root: string, options: SearchOptions = {}): ClosableSearchPort {
  let index: AnyOrama | null = null
  let builtAt: string | null = null
  let documentCount = 0
  let building: Promise<void> | null = null

  const ensureBuilt = async (): Promise<void> => {
    if (index !== null) return
    building ??= build()
    await building
  }

  const build = async (): Promise<void> => {
    const fresh = create({ schema: SCHEMA })
    const documents = await readEveryDocument(root)

    if (documents.length > 0) await insertMultiple(fresh, documents)

    index = fresh
    documentCount = documents.length
    builtAt = new Date().toISOString()
    building = null
  }

  const reindexOne = async (path: string): Promise<void> => {
    if (index === null) return
    const document = await readDocument(root, path)

    try {
      await remove(index, path)
    } catch {
      // Not indexed yet. Inserting is all that is needed.
    }

    if (document !== null) {
      await insertMultiple(index, [document])
    }
  }

  const watcher =
    options.watch === true ? startWatching(root, reindexOne, options.debounceMs ?? 300) : null

  return {
    async search(query: SearchQuery): Promise<Result<SearchHit[]>> {
      await ensureBuilt()
      if (index === null) return ok([])

      const where: { tags?: string; type?: string } = {}
      if (query.tag !== undefined) where.tags = query.tag
      if (query.type !== undefined) where.type = query.type

      const limit = query.limit ?? 20

      const results = await oramaSearch(index, {
        term: query.q,
        properties: ['title', 'headings', 'tags', 'body'],
        boost: FIELD_WEIGHTS,
        // Ask for more than we need: the folder filter and the archive penalty
        // both reshape the ranking after Orama has done its part.
        limit: limit * 4,
        ...(Object.keys(where).length > 0 ? { where } : {}),
      })

      const hits = results.hits
        .map((hit) => toHit(hit.document as unknown as IndexedDocument, hit.score))
        .filter((hit) => matchesFolder(hit.path, query.folder))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return ok(hits)
    },

    /**
     * Backs the near-duplicate guard. Returns candidates from the same folder
     * for the guard to score itself — this decides what is close enough to
     * look at, not what counts as a duplicate.
     */
    async similar(body: string, folder: string, limit: number): Promise<SearchHit[]> {
      await ensureBuilt()
      if (index === null) return []

      const term = distinctiveWords(body)
      if (term === '') return []

      const results = await oramaSearch(index, {
        term,
        properties: ['title', 'body'],
        limit: limit * 3,
      })

      return results.hits
        .map((hit) => toHit(hit.document as unknown as IndexedDocument, hit.score))
        .filter((hit) => folderOf(hit.path) === folder)
        .slice(0, limit)
    },

    onWrite(path: DocPath) {
      // Fire and forget: a write must never wait on the index, and a stale
      // index is only ever a worse answer, not a wrong file.
      void reindexOne(path).catch(() => {})
    },

    async rebuild(): Promise<Result<{ documents: number }>> {
      index = null
      building = null
      await ensureBuilt()
      return ok({ documents: documentCount })
    },

    freshness() {
      return { builtAt, documents: documentCount, stale: index === null }
    },

    async close() {
      await watcher?.close()
    },
  }
}

function toHit(document: IndexedDocument, score: number): SearchHit {
  const archived = document.folder.startsWith('90-archive')

  return {
    path: document.path as DocPath,
    ...(document.title === '' ? {} : { title: document.title }),
    snippet: snippetOf(document.body),
    score: archived ? score * ARCHIVE_RANK_PENALTY : score,
    ...(document.updated === '' ? {} : { updated: document.updated }),
    ...(document.status === '' ? {} : { status: document.status }),
  }
}

function matchesFolder(path: string, folder: string | undefined): boolean {
  if (folder === undefined) return true
  const wanted = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  return path === wanted || path.startsWith(`${wanted}/`)
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`
}

/**
 * A whole document makes a poor query. The longest words carry the most signal
 * and the fewest false matches, which is what the duplicate guard wants.
 */
function distinctiveWords(body: string): string {
  const words = body
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4)

  return [...new Set(words)].slice(0, 12).join(' ')
}

async function readEveryDocument(root: string): Promise<IndexedDocument[]> {
  const files = await fg('**/*.md', {
    cwd: root,
    ignore: ['.git/**', '.brain/**', 'node_modules/**'],
    dot: false,
  })

  const documents: IndexedDocument[] = []
  for (const file of files) {
    if (file === 'content-structure.md' || file === 'README.md') continue
    const document = await readDocument(root, file)
    if (document !== null) documents.push(document)
  }

  return documents
}

interface Frontmatter {
  title?: unknown
  tags?: unknown
  type?: unknown
  status?: unknown
  updated?: unknown
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

async function readDocument(root: string, path: string): Promise<IndexedDocument | null> {
  const relativePath = path.replace(/\\/g, '/')

  try {
    const raw = await readFile(join(root, ...relativePath.split('/')), 'utf8')
    const parsed = matter(raw)
    // Frontmatter is agent-written and lints rather than validates, so every
    // field here has to survive being absent or the wrong shape.
    const front = parsed.data as Frontmatter

    return {
      path: relativePath,
      title: text(front.title),
      headings: headingsOf(parsed.content),
      tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
      type: text(front.type),
      status: text(front.status),
      updated: text(front.updated),
      folder: folderOf(relativePath),
      body: parsed.content,
    }
  } catch {
    // Deleted between listing and reading, or unreadable. Not indexable.
    return null
  }
}

function headingsOf(body: string): string {
  return body
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ''))
    .join(' ')
}

function startWatching(
  root: string,
  reindex: (path: string) => Promise<void>,
  debounceMs: number,
): { close(): Promise<void> } {
  const changed = new Set<string>()
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    timer = null
    const batch = [...changed]
    changed.clear()
    for (const path of batch) void reindex(path).catch(() => {})
  }

  const queue = (absolute: string) => {
    if (!absolute.endsWith('.md')) return
    const path = relative(root, absolute).split(sep).join('/')
    if (path.startsWith('.git/') || path.startsWith('.brain/')) return

    changed.add(path)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
    timer.unref?.()
  }

  const watcher = watch(root, {
    ignored: (path: string) => path.includes(`${sep}.git`) || path.includes(`${sep}.brain`),
    ignoreInitial: true,
    persistent: false,
  })

  watcher.on('add', queue)
  watcher.on('change', queue)
  watcher.on('unlink', queue)

  return {
    close: async () => {
      if (timer !== null) clearTimeout(timer)
      await watcher.close()
    },
  }
}
