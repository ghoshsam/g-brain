import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { authorise } from '../auth/index.js'
import { lint, parseDoc, stampMeta, stringifyDoc } from '../doc/index.js'
import { checkDuplicate, checkRate, checkSize, scanSecrets } from '../guards/index.js'
import type { LinksResult } from '../links/index.js'
import { getLinks as resolveLinks } from '../links/index.js'
import { containPath, folderOf } from '../paths/index.js'
import { appendRaw, exists, readRaw, removeDoc, writeRaw } from '../store/index.js'
import type { FolderNode, StructureResult } from '../structure/index.js'
import {
  checkDrift,
  getStructure as readStructure,
  getTree as readTree,
} from '../structure/index.js'
import type {
  AuditEntry,
  BrainContext,
  Doc,
  DocMeta,
  DocPath,
  DriftRecord,
  LintFinding,
  Result,
  Revision,
  SearchHit,
  SearchQuery,
} from '../types.js'
import { err, ok } from '../types.js'

export interface WriteOutput {
  path: DocPath
  etag: string
  created: boolean
  /** Warnings. Never a reason the write was refused. */
  lint: LintFinding[]
  /** Set when the folder is not described in content-structure.md. The write still succeeded. */
  drift?: DriftRecord
  stamped: string[]
}

export interface ListFilters {
  folder?: string
  tag?: string
  type?: string
  status?: string
  updatedSince?: string
  limit?: number
  cursor?: string
}

type Action = AuditEntry['action']

// --- reads ------------------------------------------------------------------

export async function getStructure(
  ctx: BrainContext,
  options: { project?: string } = {},
): Promise<Result<StructureResult>> {
  return await readStructure(ctx, options)
}

export interface ProjectSummary {
  /** The directory name under the projects folder, which is also the project code. */
  project: string
  docCount: number
  /**
   * Repositories this project maps to, from `repos:` on the project README.
   * Shown, never consulted for access — frontmatter is agent-written and
   * unenforced, so deciding on it would be the bypass ADR-0008 prevents.
   */
  repos?: string[]
}

export async function listProjects(ctx: BrainContext): Promise<Result<ProjectSummary[]>> {
  const tree = await readTree(ctx)
  if (!tree.ok) return tree

  // The tree is already pruned to what this actor may read, so an unreadable
  // project is absent here rather than listed and withheld.
  const base = ctx.config.projectsFolder
  const folder = tree.value.find((node) => node.path === base)
  if (folder === undefined) return ok([])

  const summaries: ProjectSummary[] = []
  for (const child of folder.children) {
    summaries.push({
      project: child.path.slice(base.length + 1),
      docCount: child.docCount,
      ...fieldIf('repos', await linkedRepos(ctx, child.path)),
    })
  }
  return ok(summaries)
}

async function linkedRepos(ctx: BrainContext, folder: string): Promise<string[] | undefined> {
  const path = containPath(ctx, `${folder}/README.md`)
  if (!path.ok) return undefined

  const raw = await readRaw(ctx, path.value)
  if (!raw.ok) return undefined

  const { doc } = parseDoc(path.value, raw.value.content, raw.value.etag)
  return doc.meta.repos === undefined || doc.meta.repos.length === 0 ? undefined : doc.meta.repos
}

export async function getTree(ctx: BrainContext): Promise<Result<FolderNode[]>> {
  return await readTree(ctx)
}

export async function readDoc(
  ctx: BrainContext,
  input: { path: string; at?: string },
): Promise<Result<Doc>> {
  const path = resolveReadablePath(ctx, input.path)
  if (!path.ok) return path

  if (input.at !== undefined) {
    const revision = await ctx.git.showAt(path.value, input.at)
    if (!revision.ok) return revision
    return ok(parseDoc(path.value, revision.value, `at:${input.at}`).doc)
  }

  const raw = await readRaw(ctx, path.value)
  if (!raw.ok) return raw
  return ok(parseDoc(path.value, raw.value.content, raw.value.etag).doc)
}

export async function getLinks(
  ctx: BrainContext,
  input: { path: string },
): Promise<Result<LinksResult>> {
  const path = resolveReadablePath(ctx, input.path)
  return path.ok ? await resolveLinks(ctx, path.value) : path
}

export async function history(
  ctx: BrainContext,
  input: { path: string; limit?: number },
): Promise<Result<Revision[]>> {
  const path = resolveReadablePath(ctx, input.path)
  return path.ok ? await ctx.git.history(path.value, input.limit) : path
}

export async function search(ctx: BrainContext, query: SearchQuery): Promise<Result<SearchHit[]>> {
  const hits = await ctx.search.search(query)
  if (!hits.ok) return hits

  // The index doesn't know who is asking, so drop anything this actor could
  // not have read directly.
  return ok(hits.value.filter((hit) => authorise(ctx.actor, folderOf(hit.path), 'read').ok))
}

export async function listDocs(
  ctx: BrainContext,
  filters: ListFilters,
): Promise<Result<{ items: DocMeta[]; nextCursor?: string }>> {
  const tree = await readTree(ctx)
  if (!tree.ok) return tree

  const wanted = filters.folder?.replace(/\\/g, '/').replace(/\/+$/, '')
  const paths: DocPath[] = []

  for (const folder of allFolderPaths(tree.value)) {
    if (wanted !== undefined && folder !== wanted && !folder.startsWith(`${wanted}/`)) continue
    if (!authorise(ctx.actor, folder, 'read').ok) continue
    paths.push(...(await documentsInFolder(ctx, folder)))
  }
  paths.sort()

  const startAt =
    filters.cursor === undefined ? 0 : Math.max(0, paths.indexOf(filters.cursor as DocPath))
  const limit = filters.limit ?? 100
  const items: DocMeta[] = []

  for (const path of paths.slice(startAt, startAt + limit)) {
    const raw = await readRaw(ctx, path)
    if (!raw.ok) continue
    const { doc } = parseDoc(path, raw.value.content, raw.value.etag)
    if (matchesFilters(doc.meta, filters)) items.push(doc.meta)
  }

  const next = paths[startAt + limit]
  return ok({ items, ...fieldIf('nextCursor', next) })
}

// --- writes -----------------------------------------------------------------

/**
 * The twelve-step write path. Steps 1-6 are the only ones that can refuse, and
 * every one refuses for safety — never because the folder isn't described in
 * content-structure.md. See ADR-0002.
 */
export async function writeDoc(
  ctx: BrainContext,
  input: { path: string; content: string; ifMatch?: string; force?: boolean },
): Promise<Result<WriteOutput>> {
  // Steps 1-4: contain, authorise, rate, size, secrets.
  const checked = await runSafetyChecks(ctx, input.path, 'write', input.content)
  if (!checked.ok) return checked
  const path = checked.value

  // Step 5: concurrency. Cheaper than the duplicate scan, so it goes first.
  const documentExists = await exists(ctx, path)
  if (documentExists && input.ifMatch === undefined) {
    return rejectAndRecord(
      ctx,
      path,
      'write',
      err(
        'PRECONDITION_REQUIRED',
        `${path} already exists. Read it first and retry with its etag as ifMatch, or use append if you are only adding to it.`,
        { path },
      ),
    )
  }

  // Step 6: near-duplicates, on create only. Overridable — the guard is a
  // heuristic and the agent may know better.
  if (!documentExists) {
    const duplicate = await checkDuplicate(ctx, path, input.content, input.force === true)
    if (!duplicate.ok) return rejectAndRecord(ctx, path, 'write', duplicate)
  }

  // Step 7: stamp and lint. Neither can fail. A document missing a title is
  // still a document, and refusing it would teach agents to stop capturing.
  const parsed = parseDoc(path, input.content, '')
  const stamped = stampMeta(parsed.doc.meta, today(), !documentExists)
  const doc: Doc = { ...parsed.doc, meta: stamped.meta }
  const findings = [...parsed.findings, ...lint(doc)]

  // Step 8: the write. Atomic — a crash leaves the old file or the new one.
  const written = await writeRaw(ctx, path, stringifyDoc(doc), fieldIf('ifMatch', input.ifMatch))
  if (!written.ok) return rejectAndRecord(ctx, path, 'write', written)

  // Steps 9-12.
  const drift = await recordSuccess(ctx, path, 'write', written.value.etag)

  return ok({
    path,
    etag: written.value.etag,
    created: written.value.created,
    lint: findings,
    stamped: stamped.stamped,
    ...fieldIf('drift', drift ?? undefined),
  })
}

/**
 * Append skips the precondition and duplicate steps: it cannot clobber a
 * concurrent writer, and adding to a document is not creating a near-duplicate.
 * Every safety guard still applies.
 */
export async function appendDoc(
  ctx: BrainContext,
  input: { path: string; content: string; section?: string },
): Promise<Result<WriteOutput>> {
  const checked = await runSafetyChecks(ctx, input.path, 'append', input.content)
  if (!checked.ok) return checked
  const path = checked.value

  const written = await appendRaw(ctx, path, input.content, input.section)
  if (!written.ok) return rejectAndRecord(ctx, path, 'append', written)

  const drift = await recordSuccess(ctx, path, 'append', written.value.etag)

  return ok({
    path,
    etag: written.value.etag,
    created: written.value.created,
    lint: [],
    stamped: [],
    ...fieldIf('drift', drift ?? undefined),
  })
}

export async function deleteDoc(
  ctx: BrainContext,
  input: { path: string; hard?: boolean },
): Promise<Result<{ archivedTo?: DocPath }>> {
  const path = containPath(ctx, input.path)
  if (!path.ok) return rejectAndRecord(ctx, input.path, 'delete', path)

  const allowed = authorise(ctx.actor, folderOf(path.value), 'write')
  if (!allowed.ok) return rejectAndRecord(ctx, path.value, 'delete', allowed)

  // A soft delete writes into 90-archive/, so the actor has to be allowed
  // there too. Under the default key profiles that is the curator alone.
  const hard = input.hard === true
  if (!hard) {
    const canArchive = authorise(ctx.actor, '90-archive', 'write')
    if (!canArchive.ok) return rejectAndRecord(ctx, path.value, 'delete', canArchive)
  }

  const removed = await removeDoc(ctx, path.value, { hard })
  if (!removed.ok) return rejectAndRecord(ctx, path.value, 'delete', removed)

  await recordSuccess(ctx, path.value, 'delete', '')
  return removed
}

// --- the shared middle ------------------------------------------------------

/**
 * Steps 1-4, shared by every mutation. Returns the contained path, or the first
 * refusal — already recorded, because a refused write leaves no other trace.
 */
async function runSafetyChecks(
  ctx: BrainContext,
  rawPath: string,
  action: Action,
  content: string,
): Promise<Result<DocPath>> {
  // 1. Contain the path. Nothing touches the disk until this passes.
  const path = containPath(ctx, rawPath)
  if (!path.ok) return rejectAndRecord(ctx, rawPath, action, path)

  // 2. Authorise before revealing whether the document exists.
  const allowed = authorise(ctx.actor, folderOf(path.value), 'write')
  if (!allowed.ok) return rejectAndRecord(ctx, path.value, action, allowed)

  // 3. Cheap limits. No point scanning a body we are about to refuse.
  const rate = checkRate(ctx)
  if (!rate.ok) return rejectAndRecord(ctx, path.value, action, rate)

  const size = checkSize(ctx, content)
  if (!size.ok) return rejectAndRecord(ctx, path.value, action, size)

  // 4. Secrets, before anything reaches the disk. A credential committed to a
  // shared repo is leaked, and no later step can take that back.
  const secrets = scanSecrets(content)
  const first = secrets[0]
  if (first !== undefined) {
    const summary = secrets.map((f) => `${f.rule} on line ${f.line}`).join(', ')
    return rejectAndRecord(
      ctx,
      path.value,
      action,
      err(
        'UNSAFE_CONTENT',
        `Possible credential in the body: ${summary}. Nothing was written. Remove the credential — do not obfuscate it — and reconsider whether this belongs in a shared brain.`,
        { findings: secrets },
      ),
      first.rule,
    )
  }

  return path
}

/**
 * Steps 9-12, once the document is safely on disk. Nothing here may fail the
 * write: losing a capture because git or the index misbehaved is the wrong
 * trade.
 */
async function recordSuccess(
  ctx: BrainContext,
  path: DocPath,
  action: Action,
  etag: string,
): Promise<DriftRecord | null> {
  // 9. Drift is noticed only now, after the write has already succeeded.
  let drift: DriftRecord | null = null
  try {
    drift = action === 'delete' ? null : await checkDrift(ctx, path)
  } catch {
    // Drift is a report, not a guarantee. Not worth failing anything over.
  }

  ctx.audit.record({
    ts: new Date().toISOString(),
    actor: ctx.actor.id,
    action,
    path,
    outcome: 'ok',
    ...fieldIf('etag', etag === '' ? undefined : etag),
    ...(drift === null ? {} : { drift: true }),
  })

  ctx.git.recordWrite(path, ctx.actor, action)
  ctx.search.onWrite(path)

  return drift
}

/**
 * Logs the refusal and hands the error straight back. A refused write produces
 * no commit, so this audit line is the only record it ever happened — which is
 * exactly what makes it worth keeping for a rejected credential.
 */
function rejectAndRecord<T>(
  ctx: BrainContext,
  path: string,
  action: Action,
  failure: Result<T>,
  finding?: string,
): Result<never> {
  if (failure.ok) throw new Error('rejectAndRecord() called with a success')

  ctx.audit.record({
    ts: new Date().toISOString(),
    actor: ctx.actor.id,
    action,
    path,
    outcome: 'rejected',
    errorCode: failure.error.code,
    ...fieldIf('finding', finding),
  })

  return failure
}

// --- small helpers ----------------------------------------------------------

function resolveReadablePath(ctx: BrainContext, rawPath: string): Result<DocPath> {
  const path = containPath(ctx, rawPath)
  if (!path.ok) return path

  const allowed = authorise(ctx.actor, folderOf(path.value), 'read')
  return allowed.ok ? path : allowed
}

/** exactOptionalPropertyTypes means we spread a key in rather than set it to undefined. */
function fieldIf<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : { [key]: value }
}

function matchesFilters(meta: DocMeta, filters: ListFilters): boolean {
  if (filters.tag !== undefined && !meta.tags.includes(filters.tag)) return false
  if (filters.type !== undefined && meta.type !== filters.type) return false
  if (filters.status !== undefined && meta.status !== filters.status) return false
  if (filters.updatedSince !== undefined) {
    if (meta.updated === undefined || meta.updated < filters.updatedSince) return false
  }
  return true
}

/** Every folder in the tree, plus '' for the brain root itself. */
function allFolderPaths(nodes: FolderNode[]): string[] {
  const folders = ['']
  const visit = (node: FolderNode) => {
    folders.push(node.path)
    for (const child of node.children) visit(child)
  }
  for (const node of nodes) visit(node)
  return folders
}

async function documentsInFolder(ctx: BrainContext, folder: string): Promise<DocPath[]> {
  const dir = folder === '' ? ctx.root : join(ctx.root, ...folder.split('/'))

  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => (folder === '' ? e.name : `${folder}/${e.name}`) as DocPath)
  } catch {
    return []
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
