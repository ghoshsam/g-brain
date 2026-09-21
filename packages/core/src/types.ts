export type Result<T> = { ok: true; value: T } | { ok: false; error: BrainError }

export type BrainErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_PATH'
  | 'PRECONDITION_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'CONFLICT'
  | 'UNSAFE_CONTENT'
  | 'TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'

export interface BrainError {
  code: BrainErrorCode
  /** Written for an agent to act on: what happened and what to do next. */
  message: string
  /** Code-specific payload: the current etag, the conflicting path, the finding. */
  details?: Record<string, unknown>
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export const err = (
  code: BrainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<never> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
})

export const isOk = <T>(r: Result<T>): r is { ok: true; value: T } => r.ok

/** Brain-root-relative path to a .md file. Branded so an unvalidated string cannot be passed. */
export type DocPath = string & { readonly __brand: 'DocPath' }

export interface Scope {
  /** Brain-root-relative folder prefix. '' means the whole brain. */
  folder: string
  read: boolean
  write: boolean
}

export interface Actor {
  /** Key id from .brain/agents.json, or 'local' for an unauthenticated stdio caller. */
  id: string
  name: string
  scopes: Scope[]
}

export interface BrainConfig {
  brainRoot: string
  gitAutocommit: boolean
  gitAuthorSuffix: string
  gitDebounceMs: number
  mcpTransport: 'stdio' | 'http'
  mcpHttpPort: number
  authRequired: boolean
  maxDocBytes: number
  rateLimitPerMinute: number
  auditMaxBytes: number
  auditKeep: number
  duplicateThreshold: number
  searchMode: 'lexical'
  sessionExpiryDays: number
  /**
   * The folder projects live under. Configurable because presets disagree:
   * `default` says `20-projects`, `personal` says `projects`. Core cannot read
   * the name out of the structure document without parsing it for meaning,
   * which ADR-0001 rejects.
   */
  projectsFolder: string
}

export type DocStatus = 'draft' | 'active' | 'superseded'

export interface DocMeta {
  path: DocPath
  title?: string
  type?: string
  tags: string[]
  created?: string
  updated?: string
  id?: string
  status?: DocStatus
  project?: string
  /** Repositories this relates to. Context, never identity. See ADR-0005. */
  repos?: string[]
  source?: string
  supersedes?: string
  supersededBy?: string
  needsFiling?: boolean
  expires?: string
  /** Any frontmatter key not in the list above. Never dropped on a round trip. */
  extra: Record<string, unknown>
}

export interface Doc {
  meta: DocMeta
  body: string
  etag: string
}

export interface WriteReceipt {
  path: DocPath
  etag: string
  created: boolean
}

export interface LintFinding {
  rule:
    | 'missing-title'
    | 'unknown-type'
    | 'filename-case'
    | 'multiple-h1'
    | 'needs-filing-outside-inbox'
    | 'malformed-frontmatter'
  message: string
  line?: number
}

export interface DriftRecord {
  path: DocPath
  reason: 'undeclared-folder' | 'root-level-document'
}

export interface Revision {
  sha: string
  author: string
  date: string
  message: string
}

export interface AuditEntry {
  ts: string
  actor: string
  action: 'write' | 'append' | 'delete' | 'revert' | 'structure-write'
  path: string
  outcome: 'ok' | 'rejected'
  etag?: string
  drift?: boolean
  errorCode?: BrainErrorCode
  /** Rule name only, never the matched secret. */
  finding?: string
}

export interface SearchQuery {
  q: string
  folder?: string
  tag?: string
  type?: string
  limit?: number
}

export interface SearchHit {
  path: DocPath
  title?: string
  snippet: string
  score: number
  updated?: string
  status?: string
}

export interface GitPort {
  /** Fire-and-forget, debounced. Never rejects the caller's write. */
  recordWrite(path: DocPath, actor: Actor, action: string): void
  /** Commit whatever the debounce is still holding. */
  flush(): Promise<void>
  history(path: DocPath, limit?: number): Promise<Result<Revision[]>>
  showAt(path: DocPath, sha: string): Promise<Result<string>>
  revert(path: DocPath, sha: string, actor: Actor): Promise<Result<WriteReceipt>>
  status(): Promise<{ clean: boolean; head: string | null; ahead: number }>
}

export interface AuditPort {
  record(entry: AuditEntry): void
  tail(limit: number): Promise<AuditEntry[]>
}

export interface Retriever {
  search(query: SearchQuery): Promise<Result<SearchHit[]>>
  similar(body: string, folder: string, limit: number): Promise<SearchHit[]>
}

export interface SearchPort extends Retriever {
  onWrite(path: DocPath): void
  rebuild(): Promise<Result<{ documents: number }>>
  freshness(): { builtAt: string | null; documents: number; stale: boolean }
}

export interface BrainContext {
  /** Absolute, validated BRAIN_ROOT. */
  root: string
  config: BrainConfig
  actor: Actor
  git: GitPort
  audit: AuditPort
  search: SearchPort
}
