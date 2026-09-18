import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { assertSafeBrainRoot } from '../config/index.js'
import type { Result } from '../types.js'
import { err, ok } from '../types.js'

const run = promisify(execFile)

export interface Preset {
  name: string
  /** First '# ' heading, or the filename if there is none. */
  title: string
  /** The paragraph under the heading, used as the one-line description. */
  summary: string
  markdown: string
}

export interface InitResult {
  root: string
  preset: string
  gitInitialised: boolean
  seededDocuments: number
  snippet: string
}

/**
 * Presets are discovered, not listed in code. Dropping a markdown file into
 * seed/presets/ is enough to offer a new one.
 */
export async function listPresets(): Promise<Preset[]> {
  const dir = await findSeedDirectory('presets')
  if (dir === null) return []

  const files = (await readdir(dir)).filter((name) => name.endsWith('.md') && name !== 'README.md')

  const presets: Preset[] = []
  for (const file of files.sort()) {
    const markdown = await readFile(join(dir, file), 'utf8')
    presets.push({
      name: file.replace(/\.md$/, ''),
      title: headingOf(markdown) ?? file,
      summary: summaryOf(markdown),
      markdown,
    })
  }

  return presets
}

/**
 * Create a brain: its own git repo, a structure document from a preset, one
 * example document per folder, and a README carrying the MCP snippet.
 *
 * Refuses a target inside an existing repo that is not the brain's own. That is
 * the accident with lasting consequences — with GIT_AUTOCOMMIT on, an agent's
 * captures would be committed into that project's working tree.
 */
export async function initBrain(input: {
  dir: string
  preset?: string
  force?: boolean
  seed?: boolean
}): Promise<Result<InitResult>> {
  const root = resolve(input.dir)

  const alreadyThere = await hasContent(root)
  if (alreadyThere && input.force !== true) {
    return err(
      'CONFLICT',
      `${root} already contains a brain. Pass --force to write over it, or choose an empty directory.`,
      { root },
    )
  }

  await mkdir(root, { recursive: true })

  const safe = assertSafeBrainRoot(root)
  if (!safe.ok) return safe

  const presets = await listPresets()
  const wanted = input.preset ?? 'default'
  const chosen = presets.find((p) => p.name === wanted)
  if (chosen === undefined) {
    const available = presets.map((p) => p.name).join(', ')
    return err(
      'NOT_FOUND',
      `No preset called "${wanted}". Available: ${available || 'none found'}.`,
      { preset: wanted },
    )
  }

  await writeFile(join(root, 'content-structure.md'), chosen.markdown, 'utf8')

  for (const folder of foldersIn(chosen.markdown)) {
    await mkdir(join(root, folder), { recursive: true })
  }

  const seededDocuments = input.seed === false ? 0 : await copySeedContent(root)
  const gitInitialised = await initGitRepo(root)

  const snippet = mcpSnippet(root)
  await writeFile(join(root, 'README.md'), readmeFor(root, chosen.name, snippet), 'utf8')
  await writeFile(join(root, '.gitignore'), '.brain/\n', 'utf8')

  return ok({ root, preset: chosen.name, gitInitialised, seededDocuments, snippet })
}

export function mcpSnippet(root: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'g-brain': {
          command: 'npx',
          args: ['-y', 'gbrain-mcp'],
          env: { BRAIN_ROOT: root.replace(/\\/g, '/') },
        },
      },
    },
    null,
    2,
  )
}

async function hasContent(root: string): Promise<boolean> {
  try {
    return (await readdir(root)).length > 0
  } catch {
    return false
  }
}

async function initGitRepo(root: string): Promise<boolean> {
  try {
    await run('git', ['init', '--quiet'], { cwd: root })
    return true
  } catch {
    // Git missing is not fatal — the brain is still a folder of markdown, and
    // history can be turned on later.
    return false
  }
}

/** Copies seed/brain/, so an agent sees the conventions demonstrated. */
async function copySeedContent(root: string): Promise<number> {
  const dir = await findSeedDirectory('brain')
  if (dir === null) return 0

  let copied = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // The structure document came from the chosen preset, not from the sample.
    if (entry.name === 'content-structure.md') continue

    await cp(join(dir, entry.name), join(root, entry.name), { recursive: true, force: true })
    copied += entry.isDirectory() ? await countMarkdown(join(dir, entry.name)) : 1
  }

  return copied
}

async function countMarkdown(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await countMarkdown(join(dir, entry.name))
    else if (entry.name.endsWith('.md')) total++
  }
  return total
}

async function findSeedDirectory(which: 'presets' | 'brain'): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = ['../../../../seed', '../../../seed', '../../seed', '../../../../../seed']

  for (const candidate of candidates) {
    const dir = join(here, candidate, which)
    try {
      await readdir(dir)
      return dir
    } catch {
      // Try the next layout.
    }
  }

  return null
}

function foldersIn(structure: string): string[] {
  const folders = new Set<string>()
  for (const line of structure.split('\n')) {
    const match = /^##\s+([A-Za-z0-9._-]+)\//.exec(line.trim())
    if (match?.[1] !== undefined) folders.add(match[1])
  }
  return [...folders]
}

function headingOf(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim()
  }
  return null
}

function summaryOf(markdown: string): string {
  const lines = markdown.split('\n')
  const headingAt = lines.findIndex((l) => l.startsWith('# '))
  if (headingAt === -1) return ''

  const paragraph: string[] = []
  for (const line of lines.slice(headingAt + 1)) {
    if (line.trim() === '') {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line.trim())
  }

  return paragraph.join(' ').slice(0, 200)
}

function readmeFor(root: string, preset: string, snippet: string): string {
  return `# Brain

Shared memory for agentic tools. Every document here is plain markdown in a git
repo, so it stays readable with nothing installed.

\`content-structure.md\` is the filing convention — it says where each kind of
content belongs, and agents read it before deciding a path. Started from the
**${preset}** preset. Edit it whenever the convention should change: existing
files are never moved, and \`gbrain doctor\` reports what no longer matches.

## Connect an agent

Add this to your MCP client's configuration:

\`\`\`json
${snippet}
\`\`\`

Then ask it to remember something — without naming a folder.

## Look after it

\`\`\`bash
gbrain doctor          # drift, broken links, orphans, duplicates, inbox
git -C "${root.replace(/\\/g, '/')}" log --oneline
\`\`\`
`
}
