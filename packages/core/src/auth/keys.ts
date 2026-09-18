import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Actor, Result, Scope } from '../types.js'
import { err, ok } from '../types.js'
import { LOCAL_ACTOR } from './index.js'

interface StoredKey {
  id: string
  name: string
  /** sha256 of the key. The key itself is never written down. */
  hash: string
  scopes: Scope[]
}

const AGENTS_FILE = ['.brain', 'agents.json']

/**
 * The default key profiles. Narrow beats convenient: a recall agent that
 * physically cannot write is the only preventive control in ADR-0007, and it
 * costs nothing to set up here.
 */
export const DEFAULT_PROFILES: Record<string, Scope[]> = {
  capture: [
    { folder: '00-inbox', read: true, write: true },
    { folder: '05-memory', read: true, write: true },
    { folder: '10-knowledge', read: true, write: true },
    { folder: '20-projects', read: true, write: true },
    { folder: '40-decisions', read: true, write: true },
    { folder: '60-sessions', read: true, write: true },
    // Reads everything, so it can search before creating a near-duplicate.
    { folder: '', read: true, write: false },
  ],
  recall: [{ folder: '', read: true, write: false }],
  // The only profile permitted to write 90-archive/, so archiving is always
  // attributable to a curation run.
  curator: [{ folder: '', read: true, write: true }],
}

const hashOf = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex')

export async function resolveActor(
  root: string,
  authRequired: boolean,
  presentedKey: string | null,
): Promise<Result<Actor>> {
  if (presentedKey === null || presentedKey === '') {
    if (!authRequired) return ok(LOCAL_ACTOR)
    return err(
      'UNAUTHORIZED',
      'This brain requires a key. Send it as: Authorization: Bearer <key>.',
    )
  }

  const keys = await readKeys(root)
  const presented = Buffer.from(hashOf(presentedKey), 'hex')

  for (const stored of keys) {
    const known = Buffer.from(stored.hash, 'hex')
    // Same length by construction, but guard anyway — timingSafeEqual throws
    // on a mismatch rather than returning false.
    if (known.length === presented.length && timingSafeEqual(known, presented)) {
      return ok({ id: stored.id, name: stored.name, scopes: stored.scopes })
    }
  }

  return err('UNAUTHORIZED', 'That key is not registered for this brain.')
}

/** Returns the plaintext key once. It is never stored and cannot be recovered. */
export async function generateKey(
  root: string,
  name: string,
  scopes: Scope[],
): Promise<Result<{ key: string; id: string }>> {
  const key = `gbk_${randomBytes(24).toString('base64url')}`
  const id = randomBytes(6).toString('hex')

  try {
    const keys = await readKeys(root)
    keys.push({ id, name, hash: hashOf(key), scopes })

    await mkdir(join(root, '.brain'), { recursive: true })
    await writeFile(keysPath(root), `${JSON.stringify(keys, null, 2)}\n`, 'utf8')
  } catch (error) {
    return err('NOT_FOUND', `Could not write the key file: ${String(error)}`, { root })
  }

  return ok({ key, id })
}

export async function listKeys(root: string): Promise<Array<{ id: string; name: string }>> {
  return (await readKeys(root)).map(({ id, name }) => ({ id, name }))
}

const keysPath = (root: string): string => join(root, ...AGENTS_FILE)

async function readKeys(root: string): Promise<StoredKey[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(keysPath(root), 'utf8'))
    return Array.isArray(parsed) ? (parsed as StoredKey[]) : []
  } catch {
    // No key file yet is the normal case for a local brain.
    return []
  }
}
