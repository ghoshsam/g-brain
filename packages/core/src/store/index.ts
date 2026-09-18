import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { lock } from 'proper-lockfile'
import type { BrainContext, DocPath, Result, WriteReceipt } from '../types.js'
import { err, ok } from '../types.js'

export interface WriteOptions {
  ifMatch?: string
  /** Create-only, and owned by the near-duplicate guard. The store accepts it and ignores it. */
  force?: boolean
}

const ARCHIVE_ROOT = '90-archive'
const ETAG_PREFIX = 'sha256:'
const LOCK_STALE_MS = 10_000
const LOCK_UPDATE_MS = 5_000
// The lock covers a read-modify-write of a few milliseconds, so contention
// clears almost immediately. Back off for about two seconds, then give up and
// let the caller retry — a longer stall buys nothing and hides a stuck holder.
const LOCK_RETRIES = { retries: 8, factor: 2, minTimeout: 20, maxTimeout: 400, randomize: true }
const RENAME_ATTEMPTS = 5
const RENAME_BACKOFF_MS = 20
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const TEMP_MAX_AGE_MS = 60 * 60 * 1_000

export async function readRaw(
  ctx: BrainContext,
  path: DocPath,
): Promise<Result<{ content: string; etag: string }>> {
  const bytes = await readBytes(absolutePathOf(ctx, path))
  if (bytes === null) {
    return err(
      'NOT_FOUND',
      `No document at ${path}. List the folder to find the right path, or write to this path to create it.`,
      { path },
    )
  }
  return ok({ content: bytes.toString('utf8'), etag: etagFor(bytes) })
}

export async function exists(ctx: BrainContext, path: DocPath): Promise<boolean> {
  return await isFile(absolutePathOf(ctx, path))
}

/** Atomic. A crash leaves the old file or the new one, never a partial. */
export async function writeRaw(
  ctx: BrainContext,
  path: DocPath,
  content: string,
  opts: WriteOptions,
): Promise<Result<WriteReceipt>> {
  return await locked(ctx, path, async () => {
    const absolutePath = absolutePathOf(ctx, path)
    const current = await readBytes(absolutePath)

    if (current === null) {
      if (opts.ifMatch !== undefined) {
        return err(
          'PRECONDITION_FAILED',
          `No document exists at ${path}, so the ifMatch etag cannot match anything. Retry without ifMatch to create it.`,
          { path, etag: null, currentEtag: null },
        )
      }
    } else {
      const currentEtag = etagFor(current)
      if (opts.ifMatch === undefined) {
        return err(
          'PRECONDITION_REQUIRED',
          `Replacing an existing document requires ifMatch. Read ${path} first and retry with its etag.`,
          { path },
        )
      }
      if (normaliseEtag(opts.ifMatch) !== currentEtag) {
        return err(
          'PRECONDITION_FAILED',
          `${path} changed since you read it. Read it again, merge your changes into the current body, and retry with ifMatch ${currentEtag}.`,
          { path, etag: currentEtag, currentEtag },
        )
      }
    }

    const bytes = Buffer.from(content, 'utf8')
    await atomicWrite(absolutePath, bytes)
    return ok({ path, etag: etagFor(bytes), created: current === null })
  })
}

/** Needs no ifMatch and cannot clobber — the insertion point is resolved under the lock. */
export async function appendRaw(
  ctx: BrainContext,
  path: DocPath,
  content: string,
  section?: string,
): Promise<Result<WriteReceipt>> {
  return await locked(ctx, path, async () => {
    const absolutePath = absolutePathOf(ctx, path)
    const current = await readBytes(absolutePath)
    const existing = current === null ? '' : current.toString('utf8')
    const bytes = Buffer.from(spliceIntoSection(existing, content, section), 'utf8')
    await atomicWrite(absolutePath, bytes)
    return ok({ path, etag: etagFor(bytes), created: current === null })
  })
}

/** Moves to 90-archive/ mirroring the path. hard: true removes the file. */
export async function removeDoc(
  ctx: BrainContext,
  path: DocPath,
  opts: { hard?: boolean },
): Promise<Result<{ archivedTo?: DocPath }>> {
  return await locked(ctx, path, async () => {
    const absolutePath = absolutePathOf(ctx, path)
    const bytes = await readBytes(absolutePath)
    if (bytes === null) {
      return err('NOT_FOUND', `No document at ${path}, so there is nothing to delete.`, { path })
    }

    if (opts.hard === true) {
      await fs.rm(absolutePath, { force: true })
      return ok({})
    }

    const archivedTo = await freeArchivePath(ctx, archivePathFor(path))
    // The archive copy is written before the original is unlinked, so a crash between the
    // two leaves the document at both paths rather than at neither.
    await atomicWrite(absolutePathOf(ctx, archivedTo), bytes)
    await fs.rm(absolutePath, { force: true })
    return ok({ archivedTo })
  })
}

export async function withLock<T>(
  ctx: BrainContext,
  path: DocPath,
  fn: () => Promise<T>,
): Promise<Result<T>> {
  const acquired = await acquire(ctx, path)
  if (!acquired.ok) return acquired
  try {
    return ok(await fn())
  } finally {
    await acquired.value()
  }
}

async function locked<T>(
  ctx: BrainContext,
  path: DocPath,
  fn: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const acquired = await acquire(ctx, path)
  if (!acquired.ok) return acquired
  try {
    return await fn()
  } finally {
    await acquired.value()
  }
}

async function acquire(ctx: BrainContext, path: DocPath): Promise<Result<() => Promise<void>>> {
  const lockDir = join(ctx.root, '.brain', 'locks')
  await fs.mkdir(lockDir, { recursive: true })
  const lockfilePath = join(lockDir, `${sha256(Buffer.from(path, 'utf8'))}.lock`)

  try {
    const release = await lock(absolutePathOf(ctx, path), {
      lockfilePath,
      realpath: false,
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      retries: LOCK_RETRIES,
      // The etag is the guarantee, not the lock: a lock broken under us is not a correctness problem.
      onCompromised: () => {},
    })
    return ok(async () => {
      try {
        await release()
      } catch {
        // Already released, or broken by another acquirer. There is nothing to undo.
      }
    })
  } catch (e) {
    if (errnoOf(e) === 'ELOCKED') {
      return err(
        'CONFLICT',
        `Another writer holds the lock on ${path}. Wait a moment and retry; if this persists, a process writing that document is stuck.`,
        { path, reason: 'lock-timeout' },
      )
    }
    throw e
  }
}

async function atomicWrite(absolutePath: string, bytes: Buffer): Promise<void> {
  const dir = dirname(absolutePath)
  await fs.mkdir(dir, { recursive: true })
  // Same directory as the target, so the rename cannot cross a filesystem and degrade
  // to copy-then-unlink.
  const tempPath = join(dir, `.${basename(absolutePath)}.${randomUUID()}.tmp`)

  try {
    const fh = await fs.open(tempPath, 'wx')
    try {
      await fh.writeFile(bytes)
      await fh.sync()
    } finally {
      await fh.close()
    }
    await renameWithRetry(tempPath, absolutePath)
  } catch (e) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    throw e
  }

  await fsyncDir(dir)
  await sweepOrphanTemps(dir)
}

async function renameWithRetry(tempPath: string, absolutePath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tempPath, absolutePath)
      return
    } catch (e) {
      const code = errnoOf(e)
      if (attempt >= RENAME_ATTEMPTS || code === undefined || !TRANSIENT_RENAME_CODES.has(code)) {
        throw e
      }
      // Windows: an editor, indexer or antivirus holding the target open fails the rename
      // transiently. Jittered backoff up to roughly 300 ms in total.
      await sleep(RENAME_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random()))
    }
  }
}

async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const dh = await fs.open(dir, 'r')
    try {
      await dh.sync()
    } finally {
      await dh.close()
    }
  } catch {
    // The bytes are already synced; only the durability of the rename is then at the
    // filesystem's discretion.
  }
}

/** Removes temp files abandoned by a crashed writer. Never touches one that could still be live. */
async function sweepOrphanTemps(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir)
    const cutoff = Date.now() - TEMP_MAX_AGE_MS
    for (const entry of entries) {
      if (!entry.startsWith('.') || !entry.endsWith('.tmp')) continue
      const absolutePath = join(dir, entry)
      const stat = await fs.stat(absolutePath).catch(() => null)
      if (stat === null || !stat.isFile() || stat.mtimeMs > cutoff) continue
      await fs.rm(absolutePath, { force: true }).catch(() => {})
    }
  } catch {
    // Sweeping is opportunistic. A write is never failed because a leftover could not be removed.
  }
}

function spliceIntoSection(
  existing: string,
  fragment: string,
  section: string | undefined,
): string {
  const frag = fragment.replace(/^\n+/, '').replace(/\s+$/, '')
  const lines = existing === '' ? [] : existing.split('\n')

  if (section === undefined) return appendLines(lines, [frag])

  const name = headingName(section)
  const heading = findHeading(lines, name)
  // A section that does not exist is created rather than failing — append is on the capture path.
  if (heading === null) return appendLines(lines, [`## ${name}`, '', frag])

  const insertAt = endOfSection(lines, heading.index, heading.level)
  const before = lines.slice(0, insertAt)
  const after = lines.slice(insertAt)
  trimTrailingBlanks(before)
  return [...before, '', frag, '', ...after].join('\n')
}

function appendLines(lines: string[], addition: string[]): string {
  const before = [...lines]
  trimTrailingBlanks(before)
  if (before.length === 0) return `${addition.join('\n')}\n`
  return [...before, '', ...addition, ''].join('\n')
}

function trimTrailingBlanks(lines: string[]): void {
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
}

function headingName(section: string): string {
  return section.replace(/^#+\s*/, '').trim()
}

function findHeading(lines: string[], name: string): { index: number; level: number } | null {
  const wanted = name.toLowerCase()
  let fenced = false
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (isFence(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m === null) continue
    const text = (m[2] ?? '').replace(/\s+#+\s*$/, '').trim()
    if (text.toLowerCase() === wanted) return { index: i, level: (m[1] ?? '').length }
  }
  return null
}

/** The line the next heading of the same or a higher level starts on, or the end of the document. */
function endOfSection(lines: string[], headingIndex: number, level: number): number {
  let fenced = false
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (isFence(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const m = /^(#{1,6})\s+/.exec(line)
    if (m !== null && (m[1] ?? '').length <= level) return i
  }
  return lines.length
}

function isFence(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('```') || trimmed.startsWith('~~~')
}

function frontmatterEnd(lines: string[]): number {
  if ((lines[0] ?? '').trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') return i + 1
  }
  return 0
}

function archivePathFor(path: DocPath): DocPath {
  const [first, ...rest] = path.split('/')
  if (rest.length === 0) return `${ARCHIVE_ROOT}/${first ?? path}` as DocPath
  return [ARCHIVE_ROOT, (first ?? '').replace(/^\d+-/, ''), ...rest].join('/') as DocPath
}

async function freeArchivePath(ctx: BrainContext, candidate: DocPath): Promise<DocPath> {
  if (!(await isFile(absolutePathOf(ctx, candidate)))) return candidate

  const dir = posix.dirname(candidate)
  const stem = posix.basename(candidate, '.md')
  const today = new Date().toISOString().slice(0, 10)

  for (let n = 0; n < 1_000; n++) {
    const suffix = n === 0 ? '' : `-${n + 1}`
    const next = `${dir}/${stem}-archived-${today}${suffix}.md` as DocPath
    if (!(await isFile(absolutePathOf(ctx, next)))) return next
  }
  throw new Error(`Cannot find a free archive path for ${candidate}`)
}

function absolutePathOf(ctx: BrainContext, path: DocPath): string {
  return resolve(ctx.root, ...path.split('/'))
}

function etagFor(bytes: Buffer): string {
  return `${ETAG_PREFIX}${sha256(bytes)}`
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function normaliseEtag(etag: string): string {
  return etag
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1')
}

async function readBytes(absolutePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(absolutePath)
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    return (await fs.stat(absolutePath)).isFile()
  } catch (e) {
    if (isMissing(e)) return false
    throw e
  }
}

function isMissing(e: unknown): boolean {
  const code = errnoOf(e)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function errnoOf(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined
  const code = (e as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
