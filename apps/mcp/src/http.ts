import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openBrain, resolveActor } from '@g-brain/core'
import type { BrainConfig } from '@g-brain/core'
import { createSearchPort } from '@g-brain/search'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './server.js'

export interface RunningServer {
  port: number
  close(): Promise<void>
}

/**
 * The remote surface. Unlike stdio there is nobody trusted on the other end, so
 * every request carries a key and `core` decides what it may touch.
 */
export async function startHttp(config: BrainConfig): Promise<RunningServer> {
  const search = createSearchPort(config.brainRoot, { watch: true })
  const brains = new Map<string, Awaited<ReturnType<typeof openBrain>>>()

  const http = createHttpServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      send(response, 500, { error: String(error) })
    })
  })

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = request.url ?? '/'

    // The only plain HTTP endpoint. Deployment probes need an answer without a
    // key, and it says nothing a caller could not learn by connecting.
    if (url.startsWith('/health')) {
      const index = search.freshness()
      return send(response, 200, {
        status: 'ok',
        brainRoot: config.brainRoot,
        documents: index.documents,
        index: { builtAt: index.builtAt, stale: index.stale },
        autocommit: config.gitAutocommit,
      })
    }

    if (!url.startsWith('/mcp')) return send(response, 404, { error: 'Not found' })

    const key = bearerFrom(request)
    const actor = await resolveActor(config.brainRoot, config.authRequired, key)
    if (!actor.ok) {
      // 401 is the transport's way of saying what core already decided. The
      // body carries the typed code, which is what a client branches on.
      return send(response, 401, { code: actor.error.code, message: actor.error.message })
    }

    // One brain per actor: the context carries who is asking, and `core`
    // authorises every operation against it.
    let brain = brains.get(actor.value.id)
    if (brain === undefined) {
      brain = await openBrain({ actor: actor.value, search })
      brains.set(actor.value.id, brain)
    }

    // Stateless: one transport per request, no session to resume. The SDK's
    // option types are not written for exactOptionalPropertyTypes, hence the
    // casts — they are confined to these two lines.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    } as never)
    const server = createServer(brain.context)
    await server.connect(transport as never)

    response.on('close', () => {
      void transport.close()
      void server.close()
    })

    await transport.handleRequest(request, response, await readJsonBody(request))
  }

  await new Promise<void>((resolve) => http.listen(config.mcpHttpPort, resolve))

  return {
    port: config.mcpHttpPort,
    close: async () => {
      // Flush any debounced commits before the listener goes.
      for (const brain of brains.values()) await brain.close()
      await search.close()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

function bearerFrom(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST') return undefined

  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')

  if (raw === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
