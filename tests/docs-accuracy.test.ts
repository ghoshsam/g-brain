import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The user manual promises specific commands, flags and settings. If the code
// stops offering one, the manual is telling people to type something that does
// not work — which is worse than saying nothing.

const ROOT = join(import.meta.dirname, '..')
const MANUAL = join(ROOT, 'docs/user')

const manualPages = readdirSync(MANUAL)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(join(MANUAL, name), 'utf8') }))

const manualText = manualPages.map((page) => page.text).join('\n')
const cliSource = readFileSync(join(ROOT, 'apps/cli/src/index.ts'), 'utf8')
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')

const realCommands = new Set(
  [...cliSource.matchAll(/\.command\('([a-z-]+)'\)/g)].map((match) => match[1] ?? ''),
)

const realSettings = new Set(
  [...envExample.matchAll(/^([A-Z_]+)=/gm)].map((match) => match[1] ?? ''),
)

// Every setting we own contains an underscore, which is enough to tell them
// apart from shouted words in prose and from SQL keywords in examples.
const SETTING_SHAPE = /[A-Z]+(?:_[A-Z]+)+/g

// Set by the operating system, not by us.
const NOT_OURS = new Set(['USER_PROFILE', 'NODE_ENV'])

describe('the user manual matches the software', () => {
  it('names only commands that exist', () => {
    const mentioned = new Set(
      // A subcommand starts with a letter; anything starting with a dash is a
      // flag, and commander owns those.
      [...manualText.matchAll(/\bgbrain ([a-z][a-z-]*)/g)].map((match) => match[1] ?? ''),
    )
    // "npx gbrain init" and "npm install -g gbrain gbrain-mcp" both look like a
    // subcommand to a plain regex. Neither is one.
    mentioned.delete('gbrain')
    mentioned.delete('gbrain-mcp')

    for (const command of mentioned) {
      expect(realCommands, `the manual mentions "gbrain ${command}"`).toContain(command)
    }
  })

  it('documents every command the CLI offers', () => {
    for (const command of realCommands) {
      expect(manualText, `"gbrain ${command}" exists but the manual never mentions it`).toContain(
        `gbrain ${command}`,
      )
    }
  })

  it('names only settings and error codes that exist', () => {
    // SHOUTED_TOKENS in the manual are one of two things: a setting the reader
    // can change, or an error code they might see. Anything else is invented.
    const types = readFileSync(join(ROOT, 'packages/core/src/types.ts'), 'utf8')
    const errorCodes = new Set(
      [...types.matchAll(/^\s*\| '([A-Z_]+)'$/gm)].map((match) => match[1] ?? ''),
    )

    const mentioned = [...manualText.matchAll(SETTING_SHAPE)]
      .map((match) => match[0])
      .filter((word) => !NOT_OURS.has(word))

    for (const token of new Set(mentioned)) {
      const known = realSettings.has(token) || errorCodes.has(token)
      expect(
        known,
        `the manual mentions ${token}, which is neither a setting nor an error code`,
      ).toBe(true)
    }
  })

  it('documents every setting, since each one has a default somebody may want to change', () => {
    for (const setting of realSettings) {
      expect(manualText, `${setting} is configurable but the manual never mentions it`).toContain(
        setting,
      )
    }
  })

  it('does not promise tools that do not exist', () => {
    const tools = readFileSync(join(ROOT, 'apps/mcp/src/tools.ts'), 'utf8')
    const realTools = new Set(
      [...tools.matchAll(/name: '(brain_[a-z_]+)'/g)].map((match) => match[1] ?? ''),
    )

    // Not preceded by '#': a heading anchor like #brain_root-is-inside-a-repo
    // is a link target, not a tool name.
    for (const mentioned of new Set(
      [...manualText.matchAll(/(?<![#\w])(brain_[a-z_]+)\b/g)].map((match) => match[1] ?? ''),
    )) {
      expect(realTools, `the manual mentions a tool called ${mentioned}`).toContain(mentioned)
    }
  })

  it('links only to pages that exist', () => {
    const pageNames = new Set(readdirSync(MANUAL))

    for (const page of manualPages) {
      const links = [...page.text.matchAll(/\]\(\.\/([0-9A-Za-z._-]+\.md)\)/g)].map(
        (match) => match[1] ?? '',
      )

      for (const link of links) {
        expect(pageNames, `${page.name} links to ./${link}`).toContain(link)
      }
    }
  })

  it('gives every page a title and a description', () => {
    for (const page of manualPages) {
      expect(page.text.startsWith('---'), `${page.name} has no frontmatter`).toBe(true)
      expect(page.text.slice(0, 400), `${page.name} has no title`).toContain('title:')
      expect(page.text.slice(0, 400), `${page.name} has no description`).toContain('description:')
    }
  })
})
