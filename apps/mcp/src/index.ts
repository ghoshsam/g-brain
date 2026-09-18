#!/usr/bin/env node
import { loadConfig, openBrain } from '@g-brain/core'
import { createSearchPort } from '@g-brain/search'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startHttp } from './http.js'
import { createServer } from './server.js'

export { createServer, toToolResult, errorCodeOf, textOf } from './server.js'
export { startHttp } from './http.js'
export { TOOLS } from './tools.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env)

  if (config.mcpTransport === 'http') {
    const running = await startHttp(config)
    process.stderr.write(`g-brain listening on http://localhost:${running.port}/mcp
`)

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void running.close().then(() => process.exit(0))
      })
    }
    return
  }

  // stdio is a child process the client already controls, so it is trusted as
  // local unless AUTH_REQUIRED says otherwise.
  const brain = await openBrain({
    search: createSearchPort(config.brainRoot, { watch: true }),
  })
  const server = createServer(brain.context)

  // Writes commit on a debounce, so a signal has to flush or the last capture
  // of a session loses its commit.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void brain.close().then(() => process.exit(0))
    })
  }

  await server.connect(new StdioServerTransport())
}

// Only run when invoked directly, so importing this module in a test does not
// start a server on stdio.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  main().catch((error: unknown) => {
    process.stderr.write(`g-brain failed to start: ${String(error)}\n`)
    process.exit(1)
  })
}
