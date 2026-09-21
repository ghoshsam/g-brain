import { loadConfig, openBrain, resolveActor } from '@g-brain/core'
import type { BrainContext, OpenBrain, Result } from '@g-brain/core'
import { createSearchPort } from '@g-brain/search'
import { headers } from 'next/headers'

/**
 * One brain per process, not one per request. The search port owns a watcher
 * and the git port owns a debounce timer, so building them per request would
 * leak both. The actor is the only thing a request actually changes.
 */
let opened: Promise<OpenBrain> | null = null

function brain(): Promise<OpenBrain> {
  if (opened === null) {
    // BRAIN_ROOT may be unset, in which case core resolves the default. Reading
    // the env directly here would hand the search port an empty path.
    const { brainRoot } = loadConfig(process.env)
    opened = openBrain({ search: createSearchPort(brainRoot, { watch: true }) })
  }
  return opened
}

/**
 * The key a reader presented, as an opaque string. apps/web does not interpret
 * it, exactly as apps/mcp does not — core decides what it means.
 */
async function presentedKey(): Promise<string | null> {
  const authorization = (await headers()).get('authorization')
  if (authorization === null) return null

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1] ?? null
}

/**
 * Run one read as whoever is asking. There is no session and no user record:
 * the actor is the local one where AUTH_REQUIRED is false, or the key presented
 * on this request — ADR-0009.
 */
export async function withBrain<T>(
  use: (ctx: BrainContext) => Promise<Result<T>>,
): Promise<Result<T>> {
  const { context } = await brain()

  const actor = await resolveActor(context.root, context.config.authRequired, await presentedKey())
  if (!actor.ok) return actor

  return await use({ ...context, actor: actor.value })
}
