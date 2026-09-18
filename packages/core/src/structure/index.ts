import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { BrainContext, DocPath, DriftRecord, Result } from '../types.js'
import { err, ok } from '../types.js'

export interface StructureResult {
  brainName: string
  /** Raw bytes of content-structure.md, verbatim. */
  markdown: string
  structureMissing: boolean
  tree: FolderNode[]
}

export interface FolderNode {
  path: string
  docCount: number
  children: FolderNode[]
  /** True when no '## <folder>/' heading in the structure document covers it. */
  undeclared: boolean
}

const STRUCTURE_DOC = 'content-structure.md'
const EXCLUDED_FOLDERS = new Set(['.git', '.brain'])

/**
 * Headings look like '## 10-knowledge/{topic}/'. Anything without a trailing slash is
 * prose, not a folder. The extraction is deliberately shallow: it only ever reports.
 */
const HEADING =
  /^##\s+`?([A-Za-z0-9._{}][A-Za-z0-9._{}-]*(?:\/[A-Za-z0-9._{}][A-Za-z0-9._{}-]*)*)\/`?/

const PLACEHOLDER_SEGMENT = /^\{[^/]*\}$/

const toPosix = (value: string): string => value.replace(/\\/g, '/')

const segmentsOf = (value: string): string[] =>
  toPosix(value)
    .split('/')
    .filter((segment) => segment.length > 0)

export const extractFolderHeadings = (markdown: string): string[][] => {
  const headings: string[][] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = HEADING.exec(line)
    if (match === null) continue
    const segments = segmentsOf(match[1] ?? '')
    if (segments.length > 0) headings.push(segments)
  }
  return headings
}

const segmentMatches = (heading: string, actual: string): boolean =>
  PLACEHOLDER_SEGMENT.test(heading) || heading.toLowerCase() === actual.toLowerCase()

/** A heading describes a folder only when every segment lines up, one for one. */
const headingCovers = (heading: string[], folder: string[]): boolean => {
  if (heading.length !== folder.length) return false
  return heading.every((segment, index) => segmentMatches(segment, folder[index] ?? ''))
}

/** A folder is also declared when it is an ancestor of a described one. */
const headingDescends = (heading: string[], folder: string[]): boolean => {
  if (heading.length <= folder.length) return false
  return folder.every((segment, index) => segmentMatches(heading[index] ?? '', segment))
}

const isDeclared = (folder: string, headings: string[][]): boolean => {
  const segments = segmentsOf(folder)
  return headings.some(
    (heading) => headingCovers(heading, segments) || headingDescends(heading, segments),
  )
}

const countMarkdown = async (dir: string): Promise<number> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length
  } catch {
    return 0
  }
}

const walk = async (dir: string, rel: string, headings: string[][]): Promise<FolderNode[]> => {
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: FolderNode[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_FOLDERS.has(entry.name)) continue
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    const childDir = path.join(dir, entry.name)
    nodes.push({
      path: childRel,
      docCount: await countMarkdown(childDir),
      children: await walk(childDir, childRel, headings),
      undeclared: !isDeclared(childRel, headings),
    })
  }
  nodes.sort((left, right) => left.path.localeCompare(right.path))
  return nodes
}

const readStructureDoc = async (root: string): Promise<string | null> => {
  try {
    return await readFile(path.join(root, STRUCTURE_DOC), 'utf8')
  } catch {
    return null
  }
}

const rootExists = async (root: string): Promise<boolean> => {
  try {
    await readdir(root)
    return true
  } catch {
    return false
  }
}

export async function getStructure(ctx: BrainContext): Promise<Result<StructureResult>> {
  if (!(await rootExists(ctx.root))) {
    return err('NOT_FOUND', `The brain root ${ctx.root} cannot be read. Check BRAIN_ROOT exists.`)
  }
  const markdown = await readStructureDoc(ctx.root)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  return ok({
    brainName: path.basename(ctx.root),
    markdown: markdown ?? '',
    structureMissing: markdown === null,
    tree: await walk(ctx.root, '', headings),
  })
}

export async function getTree(ctx: BrainContext): Promise<Result<FolderNode[]>> {
  if (!(await rootExists(ctx.root))) {
    return err('NOT_FOUND', `The brain root ${ctx.root} cannot be read. Check BRAIN_ROOT exists.`)
  }
  const markdown = await readStructureDoc(ctx.root)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  return ok(await walk(ctx.root, '', headings))
}

export async function checkDrift(ctx: BrainContext, docPath: DocPath): Promise<DriftRecord | null> {
  const rel = toPosix(String(docPath))
  const segments = segmentsOf(rel)
  if (segments.length <= 1) {
    if (segments[0] === STRUCTURE_DOC) return null
    return { path: docPath, reason: 'root-level-document' }
  }
  const folder = segments.slice(0, -1).join('/')
  const markdown = await readStructureDoc(ctx.root)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  const folderSegments = segmentsOf(folder)
  if (headings.some((heading) => headingCovers(heading, folderSegments))) return null
  return { path: docPath, reason: 'undeclared-folder' }
}
