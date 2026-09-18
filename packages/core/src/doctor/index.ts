import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lint, parseDoc } from '../doc/index.js'
import { extractLinks } from '../links/index.js'
import { folderOf } from '../paths/index.js'
import { checkDrift, getTree } from '../structure/index.js'
import type { BrainContext, DocPath, DriftRecord, LintFinding, Result } from '../types.js'
import { ok } from '../types.js'

export interface DoctorReport {
  /** Documents in folders content-structure.md does not describe. */
  drift: DriftRecord[]
  brokenLinks: Array<{ from: DocPath; to: string }>
  /** Nothing links to these, and they link to nothing. Effectively invisible. */
  orphans: DocPath[]
  duplicates: Array<{ a: DocPath; b: DocPath; similarity: number }>
  inbox: Array<{ path: DocPath; reason?: string }>
  expired: Array<{ path: DocPath; expires: string }>
  lint: Array<{ path: DocPath; findings: LintFinding[] }>
  documentCount: number
}

/**
 * Reports. Modifies nothing.
 *
 * This is the counterweight to guards being safety-only: the brain accumulates
 * known imperfections by design, and this is what makes them visible. It is
 * exactly as useful as the attention it gets.
 */
export async function runDoctor(ctx: BrainContext): Promise<Result<DoctorReport>> {
  const tree = await getTree(ctx)
  if (!tree.ok) return tree

  const documents = await loadEveryDocument(ctx, tree.value)

  const report: DoctorReport = {
    drift: [],
    brokenLinks: [],
    orphans: [],
    duplicates: findDuplicates(documents, ctx.config.duplicateThreshold),
    inbox: [],
    expired: [],
    lint: [],
    documentCount: documents.length,
  }

  const linkedTo = new Set<string>()
  const today = new Date().toISOString().slice(0, 10)
  const existingPaths = new Set(documents.map((d) => d.path as string))

  for (const document of documents) {
    const drift = await checkDrift(ctx, document.path)
    if (drift !== null) report.drift.push(drift)

    for (const link of extractLinks(document.path, document.body)) {
      linkedTo.add(link.target)
      if (!existingPaths.has(link.target)) {
        report.brokenLinks.push({ from: document.path, to: link.target })
      }
    }

    if (folderOf(document.path).startsWith('00-inbox')) {
      const reason = firstLineOf(document.body)
      report.inbox.push({ path: document.path, ...(reason === '' ? {} : { reason }) })
    }

    const expires = document.meta.expires
    if (expires !== undefined && expires < today) {
      report.expired.push({ path: document.path, expires })
    }

    const findings = lint({ meta: document.meta, body: document.body, etag: '' })
    if (findings.length > 0) report.lint.push({ path: document.path, findings })
  }

  // An orphan has nothing pointing at it and points at nothing, so neither
  // search-by-link nor browsing the cluster will ever surface it.
  for (const document of documents) {
    const hasOutgoing = extractLinks(document.path, document.body).length > 0
    if (!hasOutgoing && !linkedTo.has(document.path)) report.orphans.push(document.path)
  }

  return ok(report)
}

interface LoadedDocument {
  path: DocPath
  meta: ReturnType<typeof parseDoc>['doc']['meta']
  body: string
}

async function loadEveryDocument(
  ctx: BrainContext,
  tree: Awaited<ReturnType<typeof getTree>> extends Result<infer T> ? T : never,
): Promise<LoadedDocument[]> {
  const { readdir } = await import('node:fs/promises')
  const folders = ['']
  const visit = (nodes: typeof tree) => {
    for (const node of nodes) {
      folders.push(node.path)
      visit(node.children)
    }
  }
  visit(tree)

  const documents: LoadedDocument[] = []

  for (const folder of folders) {
    const dir = folder === '' ? ctx.root : join(ctx.root, ...folder.split('/'))
    let entries: string[]
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map((e) => e.name)
    } catch {
      continue
    }

    for (const name of entries) {
      // The convention itself and the README that `gbrain init` writes are
      // scaffolding, not captures. Reporting them would mean every new brain
      // starts with findings nobody can act on.
      if (folder === '' && (name === 'content-structure.md' || name === 'README.md')) continue
      const path = (folder === '' ? name : `${folder}/${name}`) as DocPath
      try {
        const content = await readFile(join(ctx.root, ...path.split('/')), 'utf8')
        const { doc } = parseDoc(path, content, '')
        documents.push({ path, meta: doc.meta, body: doc.body })
      } catch {
        // A file that vanished between listing and reading is not a finding.
      }
    }
  }

  return documents
}

/** Same trigram measure the write-time guard uses, so the two agree. */
function findDuplicates(
  documents: LoadedDocument[],
  threshold: number,
): DoctorReport['duplicates'] {
  const found: DoctorReport['duplicates'] = []
  const byFolder = new Map<string, LoadedDocument[]>()

  for (const document of documents) {
    const folder = folderOf(document.path)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), document])
  }

  for (const group of byFolder.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (a === undefined || b === undefined) continue

        const similarity = diceSimilarity(trigramsOf(a.body), trigramsOf(b.body))
        if (similarity >= threshold) found.push({ a: a.path, b: b.path, similarity })
      }
    }
  }

  return found
}

function trigramsOf(body: string): Set<string> {
  const normalised = body.toLowerCase().replace(/\s+/g, ' ').trim()
  const grams = new Set<string>()
  for (let i = 0; i + 3 <= normalised.length; i++) grams.add(normalised.slice(i, i + 3))
  return grams
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared++
  return (2 * shared) / (a.size + b.size)
}

/** The one-line reason an agent leaves when it cannot place something. */
function firstLineOf(body: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed.slice(0, 200)
  }
  return ''
}
