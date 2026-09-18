import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STRUCTURE_FILE = 'content-structure.md'

// Where seed/presets/ sits relative to this file. Tried in order so it works
// from dist/ and from src/ alike.
const PRESET_LOCATIONS = ['../../../../seed/presets', '../../../seed/presets', '../../seed/presets']

/**
 * Create the brain if it is not there yet, so registering the server in a
 * client and making one call is enough to get a working brain. Does nothing
 * when the brain already exists.
 *
 * No git commits happen here — GIT_AUTOCOMMIT is off by default, and a first
 * run should not write to a repository nobody asked it to.
 */
export async function ensureBrainExists(brainRoot: string): Promise<boolean> {
  if (await hasStructureDocument(brainRoot)) return false

  await mkdir(brainRoot, { recursive: true })

  const preset = await readDefaultPreset()
  await writeFile(join(brainRoot, STRUCTURE_FILE), preset, 'utf8')

  // One folder per section, so the tree is real on the first call and an agent
  // can see the convention demonstrated rather than only described.
  for (const folder of foldersNamedIn(preset)) {
    await mkdir(join(brainRoot, folder), { recursive: true })
  }

  await writeFile(join(brainRoot, '00-inbox', '.gitkeep'), '', 'utf8').catch(() => {})
  return true
}

async function hasStructureDocument(brainRoot: string): Promise<boolean> {
  try {
    await readFile(join(brainRoot, STRUCTURE_FILE), 'utf8')
    return true
  } catch {
    return false
  }
}

async function readDefaultPreset(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))

  for (const location of PRESET_LOCATIONS) {
    try {
      return await readFile(join(here, location, 'default.md'), 'utf8')
    } catch {
      // Try the next layout.
    }
  }

  // Shipping without the presets would be a packaging bug, but failing to start
  // over it would be worse than starting with a minimal convention.
  return FALLBACK_STRUCTURE
}

/** Folder headings in the structure document, e.g. '## 10-knowledge/{topic}/'. */
function foldersNamedIn(structure: string): string[] {
  const folders = new Set<string>()

  for (const line of structure.split('\n')) {
    const match = /^##\s+([A-Za-z0-9._-]+)\//.exec(line.trim())
    if (match?.[1] !== undefined) folders.add(match[1])
  }

  return [...folders]
}

const FALLBACK_STRUCTURE = `# Content Structure

Read this before writing anything. It says where each kind of content belongs.

If nothing below fits, write to 00-inbox/ and set needs-filing: true with a
one-line reason. That is a correct answer, not a failure — a wrong guess is
invisible, and an inbox item is a queue someone empties.

## 00-inbox/

Captures you cannot confidently place yet.

## 10-knowledge/

Durable reference that outlives any single project. The test: if this project
were cancelled tomorrow, would this still be worth keeping?

## 20-projects/

Everything scoped to one active piece of work.

## 40-decisions/

Choices and the reasoning behind them. Context, options, decision, consequences.

## 90-archive/

Finished or superseded content. Archived, never deleted.
`

export async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch {
    return true
  }
}
