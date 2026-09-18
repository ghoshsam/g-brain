import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditEntry, AuditPort, BrainConfig } from '../types.js'

/**
 * The record of what happened, including what was refused.
 *
 * Git records what changed. It cannot record a rejected write, because a
 * rejection produces no commit — and a refused credential is exactly the event
 * worth keeping, since this line is its only trace.
 *
 * Plain text with no integrity guarantee: anyone with filesystem access can
 * edit it. An operational record, not evidence.
 */
export function createAuditPort(root: string, config: BrainConfig): AuditPort {
  const dir = join(root, '.brain')
  const file = join(dir, 'audit.jsonl')

  return {
    record(entry: AuditEntry) {
      try {
        mkdirSync(dir, { recursive: true })
        rotateIfLarge(dir, file, config)
        // Written synchronously and appended in one call, so a crash cannot
        // interleave two entries or lose the one that mattered.
        appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
      } catch (error) {
        process.stderr.write(`g-brain: could not write the audit log: ${String(error)}\n`)
      }
    },

    async tail(limit: number) {
      try {
        const contents = await readFile(file, 'utf8')
        const lines = contents.split('\n').filter((line) => line.trim() !== '')

        return lines
          .slice(-limit)
          .map((line) => {
            try {
              return JSON.parse(line) as AuditEntry
            } catch {
              return null
            }
          })
          .filter((entry): entry is AuditEntry => entry !== null)
      } catch {
        return []
      }
    },
  }
}

/**
 * Rotation is a rename, never a truncation, so nothing is lost at the moment it
 * happens.
 */
function rotateIfLarge(dir: string, file: string, config: BrainConfig): void {
  if (!existsSync(file)) return
  if (statSync(file).size < config.auditMaxBytes) return

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  renameSync(file, join(dir, `audit-${stamp}.jsonl`))

  void pruneOldLogs(dir, config.auditKeep)
}

async function pruneOldLogs(dir: string, keep: number): Promise<void> {
  try {
    const rotated = (await readdir(dir))
      .filter((name) => name.startsWith('audit-') && name.endsWith('.jsonl'))
      .sort()

    for (const name of rotated.slice(0, Math.max(0, rotated.length - keep))) {
      await unlink(join(dir, name))
    }
  } catch {
    // Housekeeping. Not worth surfacing.
  }
}
