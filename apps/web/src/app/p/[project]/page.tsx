import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withBrain } from '@/lib/brain'
import { getTree, listDocs } from '@g-brain/core'
import type { FolderNode } from '@g-brain/core'
import { FileText, Folder } from 'lucide-react'
import Link from 'next/link'
import { BrainErrorCard } from '../../error-page'

export const dynamic = 'force-dynamic'

function findFolder(nodes: FolderNode[], target: string): FolderNode | null {
  for (const node of nodes) {
    if (node.path === target) return node
    const found = findFolder(node.children, target)
    if (found !== null) return found
  }
  return null
}

function Tree({ node, depth = 0 }: { node: FolderNode; depth?: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 py-1 text-sm"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <Folder className="size-3.5 text-muted-foreground" />
        <span>{node.path.split('/').pop()}</span>
        {node.docCount > 0 && (
          <span className="text-xs text-muted-foreground">{node.docCount}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Tree key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default async function ProjectPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params

  const result = await withBrain(async (ctx) => {
    const folder = `${ctx.config.projectsFolder}/${project}`

    const tree = await getTree(ctx)
    if (!tree.ok) return tree

    const docs = await listDocs(ctx, { folder, limit: 500 })
    if (!docs.ok) return docs

    return {
      ok: true as const,
      value: { folder, node: findFolder(tree.value, folder), docs: docs.value.items },
    }
  })

  if (!result.ok) {
    return <BrainErrorCard code={result.error.code} message={result.error.message} />
  }

  const { folder, node, docs } = result.value

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside>
        <h2 className="mb-2 text-sm font-semibold">{project}</h2>
        {node === null ? (
          <p className="text-sm text-muted-foreground">No folders.</p>
        ) : (
          <ul className="rounded-lg border border-border p-2">
            <Tree node={node} />
          </ul>
        )}
      </aside>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Documents</h2>
        <div className="grid gap-2">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
          {docs.map((doc) => (
            <Card key={doc.path}>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="size-3.5 text-muted-foreground" />
                  <Link
                    href={`/p/${encodeURIComponent(project)}/doc?path=${encodeURIComponent(doc.path)}`}
                    className="hover:underline"
                  >
                    {doc.title ?? doc.path.slice(folder.length + 1)}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3 text-xs text-muted-foreground">
                {doc.path}
                {doc.updated !== undefined && <> · updated {doc.updated}</>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
