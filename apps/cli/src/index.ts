#!/usr/bin/env node
import {
  DEFAULT_PROFILES,
  generateKey,
  initBrain,
  listKeys,
  listPresets,
  openBrain,
  runDoctor,
} from '@g-brain/core'
import type { BrainErrorCode, DoctorReport } from '@g-brain/core'
import { createSearchPort } from '@g-brain/search'
import { Command } from 'commander'
import pc from 'picocolors'

/** Each error code gets its own exit code, so a script can branch on it. */
export const EXIT_CODES: Record<BrainErrorCode | 'OK', number> = {
  OK: 0,
  NOT_FOUND: 4,
  INVALID_PATH: 5,
  PRECONDITION_REQUIRED: 6,
  PRECONDITION_FAILED: 7,
  CONFLICT: 8,
  UNSAFE_CONTENT: 9,
  TOO_LARGE: 10,
  RATE_LIMITED: 11,
  UNAUTHORIZED: 12,
  FORBIDDEN: 13,
}

interface InitOptions {
  preset?: string
  seed?: boolean
  force?: boolean
  listPresets?: boolean
}

interface DoctorOptions {
  json?: boolean
}

interface KeyOptions {
  profile?: string
  list?: boolean
}

interface ServeOptions {
  port?: string
}

interface SearchOptions {
  folder?: string
  tag?: string
  limit?: string
}

/** '~/brain' is the documented default, so the CLI has to understand it. */
function expandHome(path: string): string {
  if (!path.startsWith('~')) return path
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
  return path.replace(/^~/, home)
}

function fail(code: BrainErrorCode, message: string): never {
  process.stderr.write(`${pc.red('error')} ${message}\n`)
  process.exit(EXIT_CODES[code])
}

const program = new Command()
  .name('gbrain')
  .description('A shared, file-backed second brain for agentic tools')
  .version('0.1.0')

program
  .command('init')
  .argument('[dir]', 'where to create the brain', '~/brain')
  .option('-p, --preset <name>', 'which preset to start from', 'default')
  .option('--no-seed', 'skip the example documents')
  .option('-f, --force', 'write into a directory that already has content')
  .option('-l, --list-presets', 'show the available presets and exit')
  .description('Create a brain and print the snippet to connect an agent')
  .action(async (dir: string, options: InitOptions) => {
    if (options.listPresets === true) {
      for (const preset of await listPresets()) {
        process.stdout.write(`${pc.bold(preset.name.padEnd(14))} ${preset.summary}\n`)
      }
      return
    }

    const result = await initBrain({
      dir: expandHome(dir),
      preset: options.preset ?? 'default',
      force: options.force === true,
      seed: options.seed !== false,
    })

    if (!result.ok) fail(result.error.code, result.error.message)

    const { root, preset, gitInitialised, seededDocuments, snippet } = result.value
    process.stdout.write(`\n${pc.green('Created a brain')} at ${pc.bold(root)}\n\n`)
    process.stdout.write(`  preset            ${preset}\n`)
    process.stdout.write(`  git repository    ${gitInitialised ? 'yes' : 'no (git not found)'}\n`)
    process.stdout.write(`  example documents ${seededDocuments}\n\n`)
    process.stdout.write(`${pc.bold('Connect an agent')} — add this to your MCP client:\n\n`)
    process.stdout.write(`${snippet}\n\n`)
    process.stdout.write(
      `Then ask it to remember something ${pc.dim('without naming a folder')}.\n` +
        `Next: ${pc.bold('gbrain doctor')} once it has written a few things.\n\n`,
    )
  })

program
  .command('doctor')
  .description('Report drift, broken links, orphans, duplicates and the inbox')
  .option('--json', 'print the raw report')
  .action(async (options: DoctorOptions) => {
    const brain = await openBrain({ create: false })
    const result = await runDoctor(brain.context)
    await brain.close()
    if (!result.ok) fail(result.error.code, result.error.message)

    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`)
      return
    }

    printReport(brain.context.root, result.value)
    // Findings are the normal state of a healthy brain, so they are not a
    // failure. Only a real fault sets a non-zero exit code.
  })

program
  .command('index')
  .description('Rebuild the search index')
  .option('--rebuild', 'rebuild from scratch (the default, and the only mode)')
  .action(async () => {
    const brain = await openBrain({ create: false })
    const search = createSearchPort(brain.context.root)

    const started = Date.now()
    const result = await search.rebuild()
    await brain.close()

    if (!result.ok) fail(result.error.code, result.error.message)

    process.stdout.write(
      `Indexed ${pc.bold(String(result.value.documents))} documents in ${Date.now() - started}ms.\n`,
    )
    process.stdout.write(`${pc.dim('The index is derived — deleting it loses nothing.')}\n`)
  })

program
  .command('search')
  .argument('<query>', 'what to look for')
  .option('-f, --folder <folder>', 'only this folder')
  .option('-t, --tag <tag>', 'only documents with this tag')
  .option('-n, --limit <n>', 'how many results', '10')
  .description('Search the brain')
  .action(async (query: string, options: SearchOptions) => {
    const brain = await openBrain({ create: false })
    const search = createSearchPort(brain.context.root)

    const hits = await search.search({
      q: query,
      ...(options.folder === undefined ? {} : { folder: options.folder }),
      ...(options.tag === undefined ? {} : { tag: options.tag }),
      limit: Number(options.limit ?? 10),
    })
    await brain.close()

    if (!hits.ok) fail(hits.error.code, hits.error.message)

    if (hits.value.length === 0) {
      process.stdout.write(`${pc.dim('Nothing matched.')}\n`)
      return
    }

    for (const hit of hits.value) {
      process.stdout.write(`\n${pc.bold(hit.title ?? hit.path)}\n`)
      process.stdout.write(`  ${pc.dim(hit.path)}\n`)
      process.stdout.write(`  ${hit.snippet}\n`)
    }
    process.stdout.write('\n')
  })

program
  .command('key')
  .argument('[name]', 'what to call this key')
  .option('-p, --profile <profile>', 'capture, recall or curator', 'capture')
  .option('-l, --list', 'show the keys this brain knows about')
  .description('Generate an agent key for the HTTP transport')
  .action(async (name: string | undefined, options: KeyOptions) => {
    const brain = await openBrain({ create: false })
    const root = brain.context.root
    await brain.close()

    if (options.list === true) {
      const keys = await listKeys(root)
      if (keys.length === 0) {
        process.stdout.write(`${pc.dim('No keys yet. Run: gbrain key <name>')}
`)
        return
      }
      for (const key of keys)
        process.stdout.write(`${pc.bold(key.id)}  ${key.name}
`)
      return
    }

    const profile = options.profile ?? 'capture'
    const scopes = DEFAULT_PROFILES[profile]
    if (scopes === undefined) {
      fail(
        'NOT_FOUND',
        `No profile called "${profile}". Try: ${Object.keys(DEFAULT_PROFILES).join(', ')}.`,
      )
    }

    const result = await generateKey(root, name ?? profile, scopes)
    if (!result.ok) fail(result.error.code, result.error.message)

    process.stdout.write(`
${pc.green('Key created')} — ${pc.bold(profile)} profile

`)
    process.stdout.write(`  ${pc.bold(result.value.key)}

`)
    process.stdout.write(`${pc.dim('Only the hash is stored, so this is the one time you will see it.')}
`)
    process.stdout.write(`${pc.dim('Send it as: Authorization: Bearer <key>')}

`)

    if (profile === 'recall') {
      process.stdout.write(`${pc.dim('This key is read-only and cannot write anywhere.')}

`)
    }
  })

program
  .command('serve')
  .description('Run the MCP server')
  .action(() => {
    process.stdout.write(
      'Run the server directly:\n\n  node apps/mcp/dist/index.js\n\nOr register it in an MCP client with the snippet from `gbrain init`.\n',
    )
  })

function printReport(root: string, report: DoctorReport): void {
  const out = (line: string) => process.stdout.write(`${line}\n`)

  out(`\n${pc.bold('Brain')} ${root}`)
  out(`${report.documentCount} documents\n`)

  const sections: Array<[string, number, string]> = [
    ['drift', report.drift.length, 'in folders the convention does not describe'],
    ['broken links', report.brokenLinks.length, 'pointing at paths that do not exist'],
    ['orphans', report.orphans.length, 'nothing links to them and they link to nothing'],
    ['near-duplicates', report.duplicates.length, 'candidates to merge'],
    ['inbox', report.inbox.length, 'waiting to be filed'],
    ['expired', report.expired.length, 'past their expires date'],
    ['lint warnings', report.lint.length, 'documents with frontmatter warnings'],
  ]

  for (const [name, count, explanation] of sections) {
    const label = count === 0 ? pc.green('0') : pc.yellow(String(count))
    out(`  ${label.padStart(12)}  ${name.padEnd(16)} ${pc.dim(explanation)}`)
  }

  if (report.inbox.length > 0) {
    out(`\n${pc.bold('Inbox')} — each with the reason the agent could not place it`)
    for (const item of report.inbox) {
      out(`  ${item.path}`)
      if (item.reason !== undefined) out(`    ${pc.dim(item.reason)}`)
    }
  }

  if (report.drift.length > 0) {
    out(`\n${pc.bold('Drift')} — these were written anyway, which is the point`)
    for (const item of report.drift) out(`  ${item.path}  ${pc.dim(item.reason)}`)
  }

  if (report.brokenLinks.length > 0) {
    out(`\n${pc.bold('Broken links')}`)
    for (const link of report.brokenLinks) out(`  ${link.from} → ${pc.red(link.to)}`)
  }

  if (report.duplicates.length > 0) {
    out(`\n${pc.bold('Near-duplicates')}`)
    for (const pair of report.duplicates) {
      out(`  ${pair.a}\n  ${pair.b}  ${pc.dim(`${Math.round(pair.similarity * 100)}% similar`)}\n`)
    }
  }

  out(`\n${pc.dim('This command reports and changes nothing.')}\n`)
}

export { program }

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  program.parseAsync(process.argv).catch((error: unknown) => {
    process.stderr.write(`${pc.red('error')} ${String(error)}\n`)
    process.exit(1)
  })
}
