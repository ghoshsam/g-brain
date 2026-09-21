import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withBrain } from '@/lib/brain'
import { search } from '@g-brain/core'
import Link from 'next/link'
import { BrainErrorCard } from '../error-page'

export const dynamic = 'force-dynamic'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; project?: string }>
}) {
  const { q, project } = await searchParams

  if (q === undefined || q.trim() === '') {
    return <p className="text-sm text-muted-foreground">Type something to search for.</p>
  }

  // The same ranking the agents get, so a reader reporting bad results is
  // reporting something reproducible.
  const result = await withBrain(async (ctx) =>
    search(ctx, {
      q,
      ...(project === undefined ? {} : { folder: `${ctx.config.projectsFolder}/${project}` }),
    }),
  )

  if (!result.ok) {
    return <BrainErrorCard code={result.error.code} message={result.error.message} />
  }

  return (
    <div className="grid gap-2">
      <p className="mb-2 text-sm text-muted-foreground">
        {result.value.length} {result.value.length === 1 ? 'result' : 'results'} for {q}
        {project !== undefined && <> in {project}</>}
      </p>

      {result.value.map((hit) => (
        <Card key={hit.path}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">
              <Link href={`/doc?path=${encodeURIComponent(hit.path)}`} className="hover:underline">
                {hit.title ?? hit.path}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="font-mono text-xs text-muted-foreground">{hit.path}</p>
            <p className="mt-1 text-sm">{hit.snippet}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
