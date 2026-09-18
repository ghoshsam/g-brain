// The public surface of core. `ops` is what apps/mcp and apps/cli call; the
// rest is exported because startup and the CLI need it. Anything not listed
// here is an implementation detail — import it by path from inside core.

export * from './types.js'
export { noopAudit, noopGit, noopSearch } from './ports.js'

export {
  appendDoc,
  deleteDoc,
  getLinks,
  getStructure,
  getTree,
  history,
  listDocs,
  readDoc,
  search,
  writeDoc,
} from './ops/index.js'
export type { ListFilters, WriteOutput } from './ops/index.js'

export { assertSafeBrainRoot, loadConfig } from './config/index.js'
export { openBrain } from './context.js'
export type { OpenBrain } from './context.js'
export { createGitPort } from './git/index.js'
export { createAuditPort } from './audit/index.js'
export { ensureBrainExists } from './bootstrap/index.js'
export { initBrain, listPresets, mcpSnippet } from './bootstrap/init.js'
export type { InitResult, Preset } from './bootstrap/init.js'
export { runDoctor } from './doctor/index.js'
export type { DoctorReport } from './doctor/index.js'
export { containPath, folderOf, toAbsolute } from './paths/index.js'
export { authorise, LOCAL_ACTOR } from './auth/index.js'
export { DEFAULT_PROFILES, generateKey, listKeys, resolveActor } from './auth/keys.js'
export { lint, parseDoc, stringifyDoc } from './doc/index.js'
export { scanSecrets } from './guards/index.js'

export type { FolderNode, StructureResult } from './structure/index.js'
export type { Link, LinksResult } from './links/index.js'
export type { SecretFinding, SecretRule } from './guards/index.js'
export type { WriteOptions } from './store/index.js'
