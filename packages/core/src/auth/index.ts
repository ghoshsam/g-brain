import type { Actor, Result, Scope } from '../types.js'
import { err, ok } from '../types.js'

/**
 * Who a local caller is. stdio is a child process the client already controls,
 * so there is nobody to authenticate.
 */
export const LOCAL_ACTOR: Actor = {
  id: 'local',
  name: 'local',
  scopes: [{ folder: '', read: true, write: true }],
}

/** '' and '/' both mean the whole brain. Everything else is a folder prefix. */
function normaliseFolder(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function covers(scope: Scope, folder: string): boolean {
  const prefix = normaliseFolder(scope.folder)
  if (prefix === '') return true

  // A scope on '10-knowledge' must not cover '10-knowledge-archive'. Match on
  // whole segments, never on a string prefix.
  return folder === prefix || folder.startsWith(`${prefix}/`)
}

export function authorise(actor: Actor, folder: string, operation: 'read' | 'write'): Result<void> {
  const target = normaliseFolder(folder)
  const permitted = actor.scopes.some(
    (scope) => covers(scope, target) && (operation === 'read' ? scope.read : scope.write),
  )

  if (permitted) return ok(undefined)

  // Deliberately vague: naming which folders exist would leak the shape of the
  // brain to a key that cannot read it.
  return err('FORBIDDEN', `This key cannot ${operation} here.`, { operation })
}
