import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type {
  Actor,
  BrainConfig,
  DocPath,
  GitPort,
  Result,
  Revision,
  WriteReceipt,
} from '../types.js'
import { err, ok } from '../types.js'

/**
 * Git is the history layer. Every write becomes a commit authored as the agent
 * that made it, which is how "who wrote this?" is answerable with no database.
 *
 * Nothing here may fail a write. By the time we are called the document is
 * already safely on disk, and losing a capture over a history problem would be
 * the wrong trade.
 */
export function createGitPort(
  root: string,
  config: BrainConfig,
): GitPort & { flush(): Promise<void> } {
  const git = simpleGit({ baseDir: root })

  // Writes accumulate here and commit together once the burst ends. An agent
  // promoting six findings should produce one commit, not six.
  const pending = new Map<string, { actor: Actor; action: string }>()
  let timer: NodeJS.Timeout | null = null
  let committing: Promise<void> = Promise.resolve()

  const commitPending = async (): Promise<void> => {
    if (pending.size === 0) return

    const batch = [...pending.entries()]
    pending.clear()

    const first = batch[0]
    if (first === undefined) return

    const [, { actor, action }] = first
    const paths = batch.map(([path]) => path)

    try {
      await git.add(paths)
      await git.commit(messageFor(action, paths), {
        '--author': `${actor.name} <${actor.id}${config.gitAuthorSuffix}>`,
      })
    } catch (error) {
      // Logged, never thrown. See the note on the port above.
      process.stderr.write(
        `g-brain: commit failed, the documents are still on disk: ${String(error)}\n`,
      )
    }
  }

  const scheduleCommit = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      committing = committing.then(commitPending)
    }, config.gitDebounceMs)
    // Do not hold the process open waiting to commit.
    timer.unref?.()
  }

  return {
    recordWrite(path, actor, action) {
      if (!config.gitAutocommit) return
      pending.set(path, { actor, action })
      scheduleCommit()
    },

    /** Commit anything still waiting. Call before a short-lived process exits. */
    async flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      committing = committing.then(commitPending)
      await committing
    },

    async history(path, limit) {
      try {
        const log = await git.log({ file: path, maxCount: limit ?? 50 })
        return ok(
          log.all.map(
            (entry): Revision => ({
              sha: entry.hash,
              author: entry.author_name,
              date: entry.date,
              message: entry.message,
            }),
          ),
        )
      } catch (error) {
        return notAGitBrain(error, path)
      }
    },

    async showAt(path, sha) {
      try {
        return ok(await git.show([`${sha}:${path}`]))
      } catch {
        return err(
          'NOT_FOUND',
          `${path} does not exist at revision ${sha}. Use brain_history to see which revisions touched it.`,
          { path, sha },
        )
      }
    },

    /**
     * Restores the old content as a NEW commit. History is never rewritten —
     * no amend, no force-push, no rebase of the brain repo.
     */
    async revert(path, sha, actor) {
      let previous: string
      try {
        previous = await git.show([`${sha}:${path}`])
      } catch {
        return err('NOT_FOUND', `${path} does not exist at revision ${sha}.`, { path, sha })
      }

      try {
        const { writeFile } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await writeFile(join(root, ...path.split('/')), previous, 'utf8')

        await git.add([path])
        await git.commit(`revert: ${path} to ${sha.slice(0, 8)}`, {
          '--author': `${actor.name} <${actor.id}${config.gitAuthorSuffix}>`,
        })

        const { createHash } = await import('node:crypto')
        const etag = `sha256:${createHash('sha256').update(previous, 'utf8').digest('hex')}`
        return ok({ path, etag, created: false } satisfies WriteReceipt)
      } catch (error) {
        return err('CONFLICT', `Could not revert ${path}: ${String(error)}`, { path, sha })
      }
    },

    async status() {
      try {
        const status = await git.status()
        return {
          clean: status.isClean(),
          head: status.current,
          ahead: status.ahead,
        }
      } catch {
        return { clean: true, head: null, ahead: 0 }
      }
    },
  }
}

function messageFor(action: string, paths: string[]): string {
  const first = paths[0] ?? 'the brain'
  if (paths.length === 1) return `${action}: ${first}`
  return `${action}: ${first} and ${paths.length - 1} more`
}

function notAGitBrain(error: unknown, path: DocPath): Result<never> {
  return err(
    'NOT_FOUND',
    `No history for ${path}. The brain may not be a git repository yet — run 'git init' in the brain root, or 'gbrain init' to set one up properly.`,
    { path, reason: String(error) },
  )
}
