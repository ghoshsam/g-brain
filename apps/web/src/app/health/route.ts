import { openBrain } from '@g-brain/core'

/**
 * The same shape apps/mcp serves, and like it, answers without a key so a
 * deployment probe can use one health endpoint across both surfaces.
 */
export async function GET() {
  const { context, close } = await openBrain({ create: false })
  try {
    return Response.json({
      ok: true,
      brain: context.root,
      autocommit: context.config.gitAutocommit,
      projectsFolder: context.config.projectsFolder,
    })
  } finally {
    await close()
  }
}
