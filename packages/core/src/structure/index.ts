import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { authorise } from '../auth/index.js'
import type { Actor, BrainContext, DocPath, DriftRecord, Result } from '../types.js'
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

const walk = async (
  dir: string,
  rel: string,
  /** The path a heading would use. Differs from `rel` under a project's own document. */
  declared: string,
  headings: string[][],
): Promise<FolderNode[]> => {
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
    const childDeclared = declared === '' ? entry.name : `${declared}/${entry.name}`
    const childDir = path.join(dir, entry.name)
    nodes.push({
      path: childRel,
      docCount: await countMarkdown(childDir),
      children: await walk(childDir, childRel, childDeclared, headings),
      undeclared: !isDeclared(childDeclared, headings),
    })
  }
  nodes.sort((left, right) => left.path.localeCompare(right.path))
  return nodes
}

const readStructureDoc = async (dir: string): Promise<string | null> => {
  try {
    return await readFile(path.join(dir, STRUCTURE_DOC), 'utf8')
  } catch {
    return null
  }
}

/**
 * Splits a folder into the project that governs it and the part inside that
 * project, or null when the folder is not inside one. The root document cannot
 * describe a project's internals, so a project may carry its own.
 */
const projectScopeOf = (
  ctx: BrainContext,
  folder: string[],
): { folder: string[]; inner: string[] } | null => {
  const base = segmentsOf(ctx.config.projectsFolder)
  if (base.length === 0 || folder.length <= base.length) return null

  const sameBase = base.every(
    (segment, index) => segment.toLowerCase() === (folder[index] ?? '').toLowerCase(),
  )
  if (!sameBase) return null

  const project = folder[base.length] ?? ''
  if (project === '') return null

  return { folder: [...base, project], inner: folder.slice(base.length + 1) }
}

const rootExists = async (root: string): Promise<boolean> => {
  try {
    await readdir(root)
    return true
  } catch {
    return false
  }
}

/**
 * A folder name is information. core/auth refuses to name folders a caller
 * cannot read, on the grounds that doing so leaks the shape of the brain — so
 * the tree it is handed has to be pruned the same way, or the tree gives back
 * exactly what the error withheld.
 */
const visibleTo = (actor: Actor, nodes: FolderNode[]): FolderNode[] => {
  const visible: FolderNode[] = []
  for (const node of nodes) {
    if (authorise(actor, node.path, 'read').ok) {
      visible.push(node)
      continue
    }
    const children = visibleTo(actor, node.children)
    // Kept only as the path to something readable below it. Its own count is
    // zeroed, because reporting it would describe documents the actor cannot
    // open.
    if (children.length > 0) visible.push({ ...node, docCount: 0, children })
  }
  return visible
}

export async function getStructure(
  ctx: BrainContext,
  options: { project?: string } = {},
): Promise<Result<StructureResult>> {
  if (!(await rootExists(ctx.root))) {
    return err('NOT_FOUND', `The brain root ${ctx.root} cannot be read. Check BRAIN_ROOT exists.`)
  }

  if (options.project === undefined) {
    const markdown = await readStructureDoc(ctx.root)
    const headings = markdown === null ? [] : extractFolderHeadings(markdown)
    return ok({
      brainName: path.basename(ctx.root),
      markdown: markdown ?? '',
      structureMissing: markdown === null,
      tree: visibleTo(ctx.actor, await walk(ctx.root, '', '', headings)),
    })
  }

  const folder = `${ctx.config.projectsFolder}/${options.project}`

  // Authorised before existence is tested, so a project out of scope cannot be
  // told apart from one that is not there.
  const allowed = authorise(ctx.actor, folder, 'read')
  if (!allowed.ok) return allowed

  const dir = path.join(ctx.root, ...segmentsOf(folder))
  if (!(await rootExists(dir))) {
    return err(
      'NOT_FOUND',
      `There is no project called ${options.project}. Call brain_structure without a project to see the ones there are.`,
    )
  }

  const markdown = await readStructureDoc(dir)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  return ok({
    brainName: options.project,
    markdown: markdown ?? '',
    structureMissing: markdown === null,
    tree: visibleTo(ctx.actor, await walk(dir, folder, '', headings)),
  })
}

export async function getTree(ctx: BrainContext): Promise<Result<FolderNode[]>> {
  if (!(await rootExists(ctx.root))) {
    return err('NOT_FOUND', `The brain root ${ctx.root} cannot be read. Check BRAIN_ROOT exists.`)
  }
  const markdown = await readStructureDoc(ctx.root)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  return ok(visibleTo(ctx.actor, await walk(ctx.root, '', '', headings)))
}

export async function checkDrift(ctx: BrainContext, docPath: DocPath): Promise<DriftRecord | null> {
  const rel = toPosix(String(docPath))
  const segments = segmentsOf(rel)
  if (segments.length <= 1) {
    if (segments[0] === STRUCTURE_DOC) return null
    return { path: docPath, reason: 'root-level-document' }
  }
  const folderSegments = segments.slice(0, -1)

  const scope = projectScopeOf(ctx, folderSegments)
  if (scope !== null) {
    const own = await readStructureDoc(path.join(ctx.root, ...scope.folder))
    if (own !== null) {
      // Directly in the project folder, so there is no subfolder to declare.
      if (scope.inner.length === 0) return null
      const declared = extractFolderHeadings(own)
      if (declared.some((heading) => headingCovers(heading, scope.inner))) return null
      return { path: docPath, reason: 'undeclared-folder' }
    }
  }

  const markdown = await readStructureDoc(ctx.root)
  const headings = markdown === null ? [] : extractFolderHeadings(markdown)
  if (headings.some((heading) => headingCovers(heading, folderSegments))) return null
  return { path: docPath, reason: 'undeclared-folder' }
}
