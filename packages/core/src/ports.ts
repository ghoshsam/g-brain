import type { AuditEntry, AuditPort, GitPort, Result, SearchHit, SearchPort } from './types.js'
import { ok } from './types.js'

export const noopGit: GitPort = {
  recordWrite: () => {},
  flush: async () => {},
  history: async () => ok([]),
  showAt: async () => ok(''),
  revert: async () => ok({ path: '' as never, etag: '', created: false }),
  status: async () => ({ clean: true, head: null, ahead: 0 }),
}

export const noopAudit: AuditPort = {
  record: () => {},
  tail: async (): Promise<AuditEntry[]> => [],
}

export const noopSearch: SearchPort = {
  search: async (): Promise<Result<SearchHit[]>> => ok([]),
  similar: async () => [],
  onWrite: () => {},
  rebuild: async () => ok({ documents: 0 }),
  freshness: () => ({ builtAt: null, documents: 0, stale: true }),
}
