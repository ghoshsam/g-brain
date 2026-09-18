import { readFile, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import fg from 'fast-glob'
import type { BrainContext, DocPath, Result } from '../types.js'
import { err, ok } from '../types.js'

export interface Link {
  target: DocPath
  raw: string
  broken: boolean
}

export interface LinksResult {
  path: DocPath
  outgoing: Link[]
  backlinks: Link[]
}

/** `[[brain-root-relative.md]]` first, then an ordinary markdown link, matched in document order. */
const LINK = /\[\[([^\][\n]+)\]\]|\[[^\][\n]*\]\(\s*([^()\s]+)(?:\s+"[^"]*")?\s*\)/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*\r?\n?/

const stripFrontmatter = (content: string): string => content.replace(FRONTMATTER, '')

function stripFences(body: string): string {
  const kept: string[] = []
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (fence === null) {
      if (marker !== undefined) {
        fence = marker
        continue
      }
      kept.push(line)
    } else if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null
    }
  }
  return kept.join('\n')
}

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** True for a path that would leave the brain root. Such a link is reported, never followed. */
const escapesRoot = (target: string): boolean =>
  target === '..' || target.startsWith('../') || posix.isAbsolute(target) || /^[a-z]:/i.test(target)

function resolveTarget(from: DocPath, written: string, wiki: boolean): string | null {
  const withoutAnchor = decode(written).split('#')[0] ?? ''
  if (withoutAnchor === '' || SCHEME.test(withoutAnchor) || withoutAnchor.startsWith('//')) {
    return null
  }
  if (!withoutAnchor.toLowerCase().endsWith('.md')) return null
  if (wiki || withoutAnchor.startsWith('/')) {
    return posix.normalize(withoutAnchor.replace(/^\/+/, ''))
  }
  return posix.normalize(posix.join(posix.dirname(from), withoutAnchor))
}

/** Pure. `broken` is always false here — only getLinks can see the filesystem. */
export function extractLinks(path: DocPath, body: string): Link[] {
  const links: Link[] = []
  for (const match of stripFences(body).matchAll(LINK)) {
    const wikiTarget = match[1]
    const written = wikiTarget ?? match[2]
    if (written === undefined) continue
    const target = resolveTarget(path, written, wikiTarget !== undefined)
    if (target === null) continue
    links.push({ target: target as DocPath, raw: written, broken: false })
  }
  return links
}

const absoluteOf = (root: string, path: string): string => join(root, ...path.split('/'))

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile()
  } catch {
    return false
  }
}

const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'EISDIR')

/**
 * Backlinks are computed, never authored: the brain is scanned and every document whose
 * outgoing links resolve to this path is reported once.
 */
async function collectBacklinks(root: string, path: DocPath): Promise<Link[]> {
  const candidates = await fg('**/*.md', {
    cwd: root,
    ignore: ['.git/**', '.brain/**'],
    onlyFiles: true,
    followSymbolicLinks: false,
  })

  const found = new Map<string, Link>()
  for (const candidate of candidates.sort()) {
    if (candidate === path || found.has(candidate)) continue
    let content: string
    try {
      content = await readFile(absoluteOf(root, candidate), 'utf8')
    } catch {
      continue
    }
    const source = candidate as DocPath
    for (const link of extractLinks(source, stripFrontmatter(content))) {
      if (link.target === path) {
        found.set(candidate, { target: source, raw: link.raw, broken: false })
        break
      }
    }
  }
  return [...found.values()]
}

export async function getLinks(ctx: BrainContext, path: DocPath): Promise<Result<LinksResult>> {
  let content: string
  try {
    content = await readFile(absoluteOf(ctx.root, path), 'utf8')
  } catch (cause) {
    if (isMissing(cause)) {
      return err('NOT_FOUND', `No document at ${path}. Check the path with brain_list.`, { path })
    }
    throw cause
  }

  const outgoing: Link[] = []
  const exists = new Map<string, boolean>()
  for (const link of extractLinks(path, stripFrontmatter(content))) {
    let present = exists.get(link.target)
    if (present === undefined) {
      present = escapesRoot(link.target) ? false : await isFile(absoluteOf(ctx.root, link.target))
      exists.set(link.target, present)
    }
    outgoing.push({ ...link, broken: !present })
  }

  return ok({ path, outgoing, backlinks: await collectBacklinks(ctx.root, path) })
}
