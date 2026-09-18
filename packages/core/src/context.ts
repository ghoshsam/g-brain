import { createAuditPort } from './audit/index.js'
import { LOCAL_ACTOR } from './auth/index.js'
import { ensureBrainExists } from './bootstrap/index.js'
import { loadConfig } from './config/index.js'
import { createGitPort } from './git/index.js'
import { noopSearch } from './ports.js'
import type { Actor, BrainContext, SearchPort } from './types.js'

export interface OpenBrain {
  context: BrainContext
  /** Commit anything the debounce is still holding. Call before exiting. */
  close(): Promise<void>
}

/**
 * Both surfaces open a brain the same way, so neither can end up with a
 * different set of ports than the other.
 */
export async function openBrain(
  options: { actor?: Actor; create?: boolean; search?: SearchPort } = {},
): Promise<OpenBrain> {
  const config = loadConfig(process.env)

  // Registering the server in a client and making one call has to be enough,
  // so a brain that is not there yet is created rather than reported missing.
  if (options.create !== false) await ensureBrainExists(config.brainRoot)

  const git = createGitPort(config.brainRoot, config)

  return {
    context: {
      root: config.brainRoot,
      config,
      actor: options.actor ?? LOCAL_ACTOR,
      git,
      audit: createAuditPort(config.brainRoot, config),
      search: options.search ?? noopSearch,
    },
    close: () => git.flush(),
  }
}
