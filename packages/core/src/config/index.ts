import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { BrainConfig, Result } from '../types.js'
import { err, ok } from '../types.js'

const TILDE_PREFIX = /^~[/\\]/

const flag = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value === 'true' || value === 'false' || value === '1' || value === '0', {
    message: 'must be true or false',
  })
  .transform((value) => value === 'true' || value === '1')

const whole = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .refine((value) => value >= min && value <= max, {
      message: `must be between ${min} and ${max}`,
    })

const fraction = z
  .string()
  .trim()
  .regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/, 'must be a number between 0 and 1')
  .transform(Number)

const schema = z.object({
  BRAIN_ROOT: z.string().trim().min(1, 'must not be blank').optional(),
  GIT_AUTOCOMMIT: flag.optional(),
  GIT_AUTHOR_SUFFIX: z.string().trim().min(1, 'must not be blank').optional(),
  GIT_DEBOUNCE_MS: whole(0, 600_000).optional(),
  MCP_TRANSPORT: z.enum(['stdio', 'http'], { message: 'must be stdio or http' }).optional(),
  MCP_HTTP_PORT: whole(1, 65_535).optional(),
  AUTH_REQUIRED: flag.optional(),
  MAX_DOC_BYTES: whole(1, 1_073_741_824).optional(),
  RATE_LIMIT_PER_MINUTE: whole(1, 1_000_000).optional(),
  AUDIT_MAX_BYTES: whole(1, 1_073_741_824).optional(),
  AUDIT_KEEP: whole(0, 1_000).optional(),
  DUPLICATE_THRESHOLD: fraction.optional(),
  SEARCH_MODE: z.literal('lexical', { message: 'must be lexical — the only v1 value' }).optional(),
  SESSION_EXPIRY_DAYS: whole(1, 36_500).optional(),
})

// Blank and unset mean the same thing: fall back to the default. Dropping them
// here keeps every field in the schema .optional() rather than each one needing
// its own empty-string case.
const supplied = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const name of Object.keys(schema.shape)) {
    const value = env[name]
    if (value?.trim()) out[name] = value
  }
  return out
}

const expandTilde = (raw: string): string => {
  if (raw === '~') return homedir()
  if (TILDE_PREFIX.test(raw)) return join(homedir(), raw.slice(2))
  return raw
}

/** realpath of the deepest existing ancestor, with the missing tail rejoined. */
const realpathTolerant = (absolute: string): string => {
  let existing = absolute
  const missing: string[] = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) return absolute
    missing.unshift(existing.slice(parent.length + 1))
    existing = parent
  }
  try {
    return join(realpathSync(existing), ...missing)
  } catch {
    return absolute
  }
}

const resolveBrainRoot = (raw: string): string => realpathTolerant(resolve(expandTilde(raw)))

const samePath = (a: string, b: string): boolean => {
  const left = a.endsWith(sep) && a.length > 1 ? a.slice(0, -1) : a
  const right = b.endsWith(sep) && b.length > 1 ? b.slice(0, -1) : b
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Throws on invalid config — this is startup, not a request. */
export function loadConfig(env: NodeJS.ProcessEnv): BrainConfig {
  const parsed = schema.safeParse(supplied(env))
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || 'config'}: ${issue.message}`,
    )
    throw new Error(
      `Invalid g-brain configuration:\n${lines.join('\n')}\nFix the variable and restart. See .env.example for the canonical list.`,
    )
  }

  const raw = parsed.data
  const mcpTransport = raw.MCP_TRANSPORT ?? 'stdio'

  return Object.freeze({
    brainRoot: resolveBrainRoot(raw.BRAIN_ROOT ?? '~/brain'),
    gitAutocommit: raw.GIT_AUTOCOMMIT ?? false,
    gitAuthorSuffix: raw.GIT_AUTHOR_SUFFIX ?? '@g-brain.local',
    gitDebounceMs: raw.GIT_DEBOUNCE_MS ?? 2000,
    mcpTransport,
    mcpHttpPort: raw.MCP_HTTP_PORT ?? 8787,
    authRequired: raw.AUTH_REQUIRED ?? mcpTransport === 'http',
    maxDocBytes: raw.MAX_DOC_BYTES ?? 262_144,
    rateLimitPerMinute: raw.RATE_LIMIT_PER_MINUTE ?? 120,
    auditMaxBytes: raw.AUDIT_MAX_BYTES ?? 8_388_608,
    auditKeep: raw.AUDIT_KEEP ?? 8,
    duplicateThreshold: raw.DUPLICATE_THRESHOLD ?? 0.9,
    searchMode: raw.SEARCH_MODE ?? 'lexical',
    sessionExpiryDays: raw.SESSION_EXPIRY_DAYS ?? 90,
  })
}

/**
 * Refuses a BRAIN_ROOT inside a foreign git repo.
 * Returns the reason so the CLI can print something actionable.
 */
export function assertSafeBrainRoot(root: string): Result<void> {
  const brainRoot = resolveBrainRoot(root)
  let dir = brainRoot
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      if (samePath(dir, brainRoot)) return ok(undefined)
      return err(
        'INVALID_PATH',
        [
          'BRAIN_ROOT resolves inside another git repository.',
          `  BRAIN_ROOT : ${brainRoot}`,
          `  repo root  : ${dir}`,
          `With GIT_AUTOCOMMIT on, an agent's captures would be committed into the working tree at ${dir}.`,
          'Set BRAIN_ROOT to a directory that is its own repo, for example ~/brain.',
        ].join('\n'),
        { brainRoot, repoRoot: dir },
      )
    }
    const parent = dirname(dir)
    if (samePath(parent, dir)) return ok(undefined)
    dir = parent
  }
}
