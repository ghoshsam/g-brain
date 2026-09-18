import { getStructure } from '@g-brain/core'
import type { BrainContext, BrainErrorCode, Result } from '@g-brain/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS } from './tools.js'

export type ToolResult = CallToolResult

/**
 * The single mapping point. core decides what happened; this only decides how
 * to say it. A switch on the code and nothing else — any logic here would be a
 * behaviour the CLI does not have.
 */
export function toToolResult<T>(result: Result<T>): ToolResult {
  if (result.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] }
  }

  const { code, message, details } = result.error
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code, message, ...details }, null, 2) }],
  }
}

/** A tool result always carries one text block. This is how you get at it. */
export function textOf(result: ToolResult): string {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

export function errorCodeOf(result: ToolResult): BrainErrorCode | null {
  if (result.isError !== true) return null
  try {
    return (JSON.parse(textOf(result)) as { code?: BrainErrorCode }).code ?? null
  } catch {
    return null
  }
}

export function createServer(ctx: BrainContext): McpServer {
  const server = new McpServer(
    { name: 'g-brain', version: '0.1.0' },
    {
      instructions: [
        'This brain is shared memory for agentic tools. Call brain_structure before your first',
        'write in a session and choose the path from the convention it returns. Search before',
        'you create. If you cannot place something confidently, write it to 00-inbox/ with',
        'needs-filing: true — that is a correct answer. Before you finish, ask what you learned',
        'that will still be true next month, and write that down.',
      ].join(' '),
    },
  )

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // The SDK infers the arg type from each tool's own schema, which this
      // loop erases. The cast is at the boundary; core validates regardless.
      (async (args: Record<string, unknown>) =>
        toToolResult(await tool.run(ctx, args ?? {}))) as never,
    )
  }

  // A mirror of brain_structure, not a replacement for it. Clients that support
  // resources can attach this for a whole session, which is the cheapest way to
  // make every write in that session land correctly. Clients that only support
  // tools lose nothing.
  server.registerResource(
    'structure',
    'brain://structure',
    {
      title: 'Filing convention',
      description: "This brain's content-structure.md and live folder tree",
      mimeType: 'text/markdown',
    },
    async () => {
      const result = await getStructure(ctx)
      const text = result.ok
        ? result.value.markdown
        : `Could not read the structure document: ${result.error.message}`

      return { contents: [{ uri: 'brain://structure', mimeType: 'text/markdown', text }] }
    },
  )

  // Convenience over brain_write, never the only way to tailor a structure
  // document — a client with tools alone can write it directly.
  server.registerPrompt(
    'define-structure',
    {
      title: 'Define this brain’s filing convention',
      description: 'Interview the user and write a tailored content-structure.md',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Read the current filing convention with brain_structure. Then interview me about',
              'how my team actually works — what kinds of things we need to remember, what',
              'projects look like, who needs to find what. Rewrite content-structure.md to fit,',
              'and write it back with brain_write.',
              '',
              'Keep it prose that a model can follow, not a schema. For each folder say what',
              'belongs and — more importantly — what does NOT belong, with one real example',
              'path. Keep an inbox and say explicitly that using it is a correct answer. Put a',
              'decision procedure at the top, before the folder list. Stay under ~400 lines: it',
              'is read on every routing decision.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  return server
}
