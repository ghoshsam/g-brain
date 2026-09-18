import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import type { BrainContext, DocPath, Result } from '../types.js'
import { err, ok } from '../types.js'

export interface SecretFinding {
  rule: string
  line: number
  /** Never the secret itself. The matched value is replaced with [redacted]. */
  excerpt: string
}

export interface SecretRule {
  name: string
  /** Must carry the g flag. Group 1, where present, is the part that gets redacted. */
  pattern: RegExp
  /** Extra check on the candidate. This is what keeps the generic rules conservative. */
  accept?: (candidate: string) => boolean
}

const shannonEntropy = (value: string): number => {
  const counts = new Map<string, number>()
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    bits -= probability * Math.log2(probability)
  }
  return bits
}

const GENERIC_MIN_LENGTH = 32
const GENERIC_MIN_ENTROPY = 3.5
const PLACEHOLDER = /^(?:x+|y+|\.+|_+|-+|0+|changeme|placeholder|your[-_].*|redacted|example.*)$/i

const looksGenerated = (candidate: string): boolean => {
  if (candidate.length < GENERIC_MIN_LENGTH) return false
  if (PLACEHOLDER.test(candidate)) return false
  return shannonEntropy(candidate) >= GENERIC_MIN_ENTROPY
}

/**
 * The complete secret rule set, curated in-repo so every rule is reviewable in the
 * diff that adds it. A false positive rejects a capture, which is the expensive
 * direction, so each rule prefers to miss a novel format over guessing.
 */
export const SECRET_RULES: SecretRule[] = [
  {
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    name: 'aws-access-key-id',
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    accept: (candidate) => !candidate.endsWith('EXAMPLE'),
  },
  {
    name: 'aws-secret-access-key',
    pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
  },
  { name: 'github-token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,251})\b/g },
  { name: 'github-fine-grained-token', pattern: /\b(github_pat_[A-Za-z0-9_]{22,})\b/g },
  { name: 'slack-token', pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  { name: 'stripe-secret-key', pattern: /\b((?:sk|rk)_live_[A-Za-z0-9]{16,})\b/g },
  { name: 'google-api-key', pattern: /\b(AIza[A-Za-z0-9_-]{35})\b/g },
  { name: 'anthropic-api-key', pattern: /\b(sk-ant-[A-Za-z0-9_-]{24,})\b/g },
  { name: 'openai-api-key', pattern: /\b(sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{24,})\b/g },
  { name: 'npm-token', pattern: /\b(npm_[A-Za-z0-9]{36})\b/g },
  {
    name: 'json-web-token',
    pattern: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    name: 'authorization-bearer-token',
    pattern: /authorization["']?\s*[:=]\s*["']?bearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi,
  },
  {
    name: 'postgres-connection-string',
    pattern: /\b(postgres(?:ql)?:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+)/gi,
  },
  {
    name: 'mongodb-connection-string',
    pattern: /\b(mongodb(?:\+srv)?:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+)/gi,
  },
  { name: 'mysql-connection-string', pattern: /\b(mysql:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+)/gi },
  { name: 'redis-connection-string', pattern: /\b(rediss?:\/\/[^\s:/@]*:[^\s:/@]+@[^\s/]+)/gi },
  { name: 'amqp-connection-string', pattern: /\b(amqps?:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+)/gi },
  { name: 'jdbc-password', pattern: /\b(jdbc:[a-z0-9]+:\S*[?&;]password=[^\s&;"']+)/gi },
  { name: 'azure-storage-account-key', pattern: /AccountKey=([A-Za-z0-9+/=]{40,})/g },
  { name: 'gcp-service-account-key-id', pattern: /"private_key_id"\s*:\s*"([a-f0-9]{40})"/g },
  {
    name: 'generic-high-entropy-assignment',
    pattern:
      /\b(?:secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{32,})/gi,
    accept: looksGenerated,
  },
]

const REDACTED = '[redacted]'
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{20,}/g
const EXCERPT_MAX = 120

/**
 * Removes the matched value and every other long token on the line, so the excerpt
 * locates the line without carrying the credential into the agent or the audit log.
 */
const redactLine = (line: string, secret: string): string => {
  const withoutSecret = secret.length > 0 ? line.split(secret).join(REDACTED) : line
  const masked = withoutSecret.replace(LONG_TOKEN, REDACTED).trim()
  return masked.length > EXCERPT_MAX ? `${masked.slice(0, EXCERPT_MAX)}…` : masked
}

export function scanSecrets(body: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.length === 0) continue
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0
      let match = rule.pattern.exec(line)
      while (match !== null) {
        const candidate = match[1] ?? match[0]
        if (rule.accept === undefined || rule.accept(candidate)) {
          findings.push({ rule: rule.name, line: index + 1, excerpt: redactLine(line, candidate) })
          break
        }
        match = rule.pattern.exec(line)
      }
    }
  }
  return findings
}

export function checkSize(ctx: BrainContext, content: string): Result<void> {
  const bytes = Buffer.byteLength(content, 'utf8')
  const limit = ctx.config.maxDocBytes
  if (bytes > limit) {
    return err(
      'TOO_LARGE',
      `This document is ${bytes} bytes and the ceiling is ${limit}. Split it into separate documents and write them one at a time.`,
      { bytes, limit },
    )
  }
  return ok(undefined)
}

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()

/** Clears the in-process token buckets. For tests, and for nothing else. */
export function resetRateLimits(): void {
  buckets.clear()
}

export function checkRate(ctx: BrainContext): Result<void> {
  const limit = ctx.config.rateLimitPerMinute
  if (limit <= 0) return ok(undefined)
  const now = Date.now()
  const bucket = buckets.get(ctx.actor.id) ?? { tokens: limit, updatedAt: now }
  const refilled = Math.min(limit, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * limit)
  if (refilled < 1) {
    buckets.set(ctx.actor.id, { tokens: refilled, updatedAt: now })
    const retryAfterSeconds = Math.max(1, Math.ceil(((1 - refilled) / limit) * 60))
    return err(
      'RATE_LIMITED',
      `This key has spent its ${limit} writes a minute. Wait ${retryAfterSeconds} seconds and retry the same request.`,
      { retryAfterSeconds, limitPerMinute: limit },
    )
  }
  buckets.set(ctx.actor.id, { tokens: refilled - 1, updatedAt: now })
  return ok(undefined)
}

const normaliseForComparison = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').trim()

const trigrams = (text: string): Set<string> => {
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= text.length; index += 1) grams.add(text.slice(index, index + 3))
  return grams
}

/** Dice coefficient over character trigram sets. 1 is identical, 0 shares nothing. */
const diceCoefficient = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

const stripFrontmatter = (content: string): string => content.replace(FRONTMATTER, '')

const folderOf = (docPath: string): string => {
  const normalised = docPath.replace(/\\/g, '/')
  const cut = normalised.lastIndexOf('/')
  return cut === -1 ? '' : normalised.slice(0, cut)
}

const MAX_CANDIDATES = 200

const candidatePaths = async (
  ctx: BrainContext,
  body: string,
  folder: string,
  own: string,
): Promise<string[]> => {
  const seen = new Set<string>()
  try {
    for (const hit of await ctx.search.similar(body, folder, 20)) {
      const candidate = String(hit.path).replace(/\\/g, '/')
      if (candidate !== own && folderOf(candidate) === folder) seen.add(candidate)
    }
  } catch {
    // The index is allowed to be wrong or absent, so a failure here is fine.
  }

  // Always list the folder too, never only when the index came back empty.
  // A stale index that returns *some* hit would otherwise hide the document we
  // most needed to compare against — which is how two identical captures both
  // got written. The index ranks candidates; the filesystem decides which
  // exist.
  try {
    const cwd = folder === '' ? ctx.root : path.join(ctx.root, ...folder.split('/'))
    for (const name of await fg('*.md', { cwd, onlyFiles: true, dot: false })) {
      const candidate = folder === '' ? name : `${folder}/${name}`
      if (candidate !== own) seen.add(candidate)
    }
  } catch {
    // An unreadable folder is not a reason to refuse a write.
  }
  return [...seen].slice(0, MAX_CANDIDATES)
}

export async function checkDuplicate(
  ctx: BrainContext,
  docPath: DocPath,
  body: string,
  force: boolean,
): Promise<Result<void>> {
  if (force) return ok(undefined)

  // Both sides must be stripped the same way. Comparing an incoming document
  // that still has its frontmatter against a stored one without it drags the
  // score down by however much of a short document the frontmatter is — which
  // is exactly how two identical bodies slipped past this guard.
  const incoming = trigrams(normaliseForComparison(stripFrontmatter(body)))
  if (incoming.size === 0) return ok(undefined)
  const own = String(docPath).replace(/\\/g, '/')
  const folder = folderOf(own)

  let best: { path: string; similarity: number } | null = null
  for (const candidate of await candidatePaths(ctx, body, folder, own)) {
    let existing: string
    try {
      existing = await readFile(path.join(ctx.root, ...candidate.split('/')), 'utf8')
    } catch {
      continue
    }
    const similarity = diceCoefficient(
      incoming,
      trigrams(normaliseForComparison(stripFrontmatter(existing))),
    )
    if (best === null || similarity > best.similarity) best = { path: candidate, similarity }
  }

  if (best !== null && best.similarity >= ctx.config.duplicateThreshold) {
    const percent = Math.round(best.similarity * 100)
    return err(
      'CONFLICT',
      `This is ${percent}% similar to ${best.path}. Append to that document instead, or retry with force true if it really is a separate capture.`,
      { existingPath: best.path, similarity: Number(best.similarity.toFixed(4)) },
    )
  }
  return ok(undefined)
}
